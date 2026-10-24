import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeBalances } from './balances'
import { createNewTrip, type Split, type TripState } from './schema'
import { convertToBase, splitAmounts } from './splits'

// Property-слой конвертации и наибольших остатков (ADR 0004): на случайных
// расходах с курсами сумма долей ровно равна конвертированному расходу — деньги
// не возникают и не исчезают на округлении. Проверяется через публичный
// интерфейс двумя сторонами одного правила: гроссбух computeBalances (минимальная
// поездка из одного расхода с чужой валютой) и экранное разбиение splitAmounts
// на курсе 1/1. Оракул квот — точная рациональная арифметика на bigint здесь
// же в тесте, независимо от приватного шва ./internal.

// Единый сид тикета: прогоны детерминированы, падение воспроизводимо.
// Другой сид: DELIM_FC_SEED=12345 npx vitest run src/core/splits.property.test.ts
const SEED = Number(process.env.DELIM_FC_SEED ?? 20261024)

const ISO = '2026-10-01T10:00:00.000Z'

/** Первые k участников сплита; плательщик p0 в сплит не входит. */
function ids(k: number): string[] {
  return Array.from({ length: k }, (_, i) => `p${i + 1}`)
}

/** Минимальная поездка: один расход в чужой валюте X с курсом rate, плательщик p0. */
function oneExpenseTrip(amount: number, rate: { num: number; den: number }, split: Split): TripState {
  const state = createNewTrip({ name: 'Конвертация', baseCurrency: 'RUB' })
  state.participants.push({ id: 'p0', name: 'Плательщик', color: '#10b981', emoji: '🦊' })
  state.participants.push(...ids(8).map((id, i) => ({ id, name: `Участник ${i + 1}`, color: '#f59e0b', emoji: '🐢' })))
  state.currencies.push({ code: 'X', rate })
  state.expenses.push({
    id: 'e1',
    title: 'Расход в чужой валюте',
    payerId: 'p0',
    amount,
    currencyCode: 'X',
    createdAt: ISO,
    split,
  })
  return state
}

/** Случайный курс: точное рациональное num/den, числитель и знаменатель из [1..10^6]. */
const rateArb = fc.record({
  num: fc.integer({ min: 1, max: 10 ** 6 }),
  den: fc.integer({ min: 1, max: 10 ** 6 }),
})

/** Случайный сплит equal/shares по k участникам. */
function proportionalSplitArb(k: number): fc.Arbitrary<ProportionalSplit> {
  return fc
    .constantFrom<'equal' | 'shares'>('equal', 'shares')
    .chain((mode): fc.Arbitrary<ProportionalSplit> => {
      if (mode === 'equal') {
        return fc.constant({ mode: 'equal', participantIds: ids(k) })
      }
      return fc
        .array(fc.integer({ min: 1, max: 10 ** 6 }), { minLength: k, maxLength: k })
        .map((weights) => ({
          mode: 'shares',
          shares: ids(k).map((participantId, i) => ({ participantId, weight: weights[i] })),
        }))
    })
}

/** Пропорциональный сплит: квоты — доли суммы, а не введённые значения. */
type ProportionalSplit = Extract<Split, { mode: 'equal' } | { mode: 'shares' }>

/** Кванты пропорционального сплита: знаменатель D и числители N_i — квота N_i/D точно. */
function quotas(
  split: ProportionalSplit,
  amount: number,
  rate: { num: number; den: number },
): { den: bigint; nums: bigint[] } {
  if (split.mode === 'equal') {
    const k = BigInt(split.participantIds.length)
    return { den: BigInt(rate.den) * k, nums: split.participantIds.map(() => BigInt(amount) * BigInt(rate.num)) }
  }
  const total = split.shares.reduce((sum, share) => sum + BigInt(share.weight), 0n)
  return {
    den: BigInt(rate.den) * total,
    nums: split.shares.map((share) => BigInt(amount) * BigInt(share.weight) * BigInt(rate.num)),
  }
}

/** Балансы как отображение «участник → сумма». */
function byId(entries: { participantId: string; amount: number }[]): Map<string, number> {
  return new Map(entries.map((entry) => [entry.participantId, entry.amount]))
}

/** Участники сплита в порядке следования — порядок квот и долей. */
function splitIds(split: Split): string[] {
  return split.mode === 'equal' ? split.participantIds : split.shares.map((share) => share.participantId)
}

describe('property-инварианты конвертации и наибольших остатков', () => {
  describe('расход с курсом — через балансы минимальной поездки', () => {
    it('кредит плательщика = convertToBase(amount), Σ дебетов = кредиту, |доля − квота| < 1', () => {
      fc.assert(
        fc.property(
          fc
            .integer({ min: 1, max: 8 })
            .chain((k) =>
              fc.record({
                split: proportionalSplitArb(k),
                amount: fc.integer({ min: 1, max: 10 ** 9 }),
                rate: rateArb,
              }),
            ),
          ({ split, amount, rate }) => {
            const balances = byId(computeBalances(oneExpenseTrip(amount, rate, split)))
            const context = `сплит ${JSON.stringify(split)}, сумма ${amount}, курс ${rate.num}/${rate.den}, балансы ${JSON.stringify([...balances])}`

            // Σ квот = amount × num/den точно → N = roundHalfUp(Σ квот) — это и
            // кредит плательщика, и convertToBase(amount, rate).
            const payerCredit = convertToBase(amount, rate)
            expect(balances.get('p0'), context).toBe(payerCredit)

            // Наибольшие остатки доводят Σ долей ровно до N: дебеты участников
            // в сумме равны кредиту плательщика, каждый дебет — целое ≥ 0.
            const participants = splitIds(split)
            let debitSum = 0
            for (const id of participants) {
              const balance = balances.get(id)!
              expect(balance, context).toBeLessThanOrEqual(0)
              debitSum += -balance
            }
            expect(debitSum, context).toBe(payerCredit)

            // Бонус-оракул: каждая доля отличается от точной квоты меньше чем
            // на минорную единицу (floor или ceil квоты). |share·D − N| < D на bigint.
            const { den, nums } = quotas(split, amount, rate)
            participants.forEach((id, i) => {
              const share = -balances.get(id)!
              expect(
                BigInt(share) * den - nums[i] < den && nums[i] - BigInt(share) * den < den,
                context,
              ).toBe(true)
            })
          },
        ),
        { seed: SEED, numRuns: 300 },
      )
    })
  })

  describe('splitAmounts на курсе 1/1 — доли до сохранения расхода', () => {
    it('equal: Σ долей ровно сумма, каждая доля — floor или ceil квоты', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 ** 9 }),
          (k, amount) => {
            const shares = splitAmounts(amount, { mode: 'equal', participantIds: ids(k) })
            const context = `сумма ${amount} на ${k} участников: ${JSON.stringify(shares)}`
            const sum = shares.reduce((acc, share) => acc + share.amount, 0)
            expect(sum, context).toBe(amount)
            for (const share of shares) {
              // |share − amount/k| < 1 ⟺ |share·k − amount| < k (целые, точно).
              expect(BigInt(share.amount) * BigInt(k) - BigInt(amount) < BigInt(k), context).toBe(true)
              expect(BigInt(amount) - BigInt(share.amount) * BigInt(k) < BigInt(k), context).toBe(true)
            }
          },
        ),
        { seed: SEED, numRuns: 300 },
      )
    })

    it('shares: Σ долей ровно сумма, |доля − квота| < 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }).chain((k) =>
            fc.record({
              weights: fc.array(fc.integer({ min: 1, max: 10 ** 6 }), { minLength: k, maxLength: k }),
              amount: fc.integer({ min: 1, max: 10 ** 9 }),
            }),
          ),
          ({ weights, amount }) => {
            const split: Split = {
              mode: 'shares',
              shares: ids(weights.length).map((participantId, i) => ({ participantId, weight: weights[i] })),
            }
            const shares = splitAmounts(amount, split)
            const total = weights.reduce((acc, weight) => acc + weight, 0)
            const context = `сумма ${amount}, веса ${JSON.stringify(weights)}: ${JSON.stringify(shares)}`
            const sum = shares.reduce((acc, share) => acc + share.amount, 0)
            expect(sum, context).toBe(amount)
            shares.forEach((share, i) => {
              // |share − amount·w_i/W| < 1 ⟺ |share·W − amount·w_i| < W (bigint).
              const lhs = BigInt(share.amount) * BigInt(total) - BigInt(amount) * BigInt(weights[i])
              expect(lhs < BigInt(total) && -lhs < BigInt(total), context).toBe(true)
            })
          },
        ),
        { seed: SEED, numRuns: 300 },
      )
    })

    it('exact: доли передаются как введено, Σ долей = Σ введённых', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }).chain((k) =>
            fc.record({
              amounts: fc.array(fc.integer({ min: 0, max: 10 ** 9 }), { minLength: k, maxLength: k }),
              expenseAmount: fc.integer({ min: 1, max: 10 ** 9 }),
            }),
          ),
          ({ amounts: introduced, expenseAmount }) => {
            // Сумма расхода не обязана покрываться exact-сплитом (UI блокирует,
            // схема допускает) — доли передаются как введено, без пересчёта.
            const split: Split = {
              mode: 'exact',
              shares: ids(introduced.length).map((participantId, i) => ({
                participantId,
                amount: introduced[i],
              })),
            }
            const shares = splitAmounts(expenseAmount, split)
            const context = `введено ${JSON.stringify(introduced)}, сумма расхода ${expenseAmount}`
            expect(shares, context).toEqual(
              introduced.map((amount, i) => ({ participantId: `p${i + 1}`, amount })),
            )
            expect(shares.reduce((acc, share) => acc + share.amount, 0), context).toBe(
              introduced.reduce((acc, amount) => acc + amount, 0),
            )
          },
        ),
        { seed: SEED, numRuns: 300 },
      )
    })
  })
})
