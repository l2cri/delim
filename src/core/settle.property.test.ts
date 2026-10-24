import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { settle, type Transfer } from './settle'
import type { BalanceEntry } from './balances'

// Третий слой тестов седения (SPEC, Testing Decisions п.2): генеративные
// инварианты на случайных компаниях — то, чего не придумать списком краёв.
// Порог гибрида — по ненулевым участникам (ADR 0006, уточнение тикета 07):
// свойство «не хуже жадного» проверяется при ≤ 12 ненулевых, «чисто жадный» —
// при 13..20. Тесты идут только через публичный интерфейс ядра (settle);
// оракул жадного слоя написан здесь независимо, по прецеденту greedyReference
// из settle.test.ts.

// Единый сид тикета: прогоны детерминированы, падение воспроизводимо.
// Другой сид: DELIM_FC_SEED=12345 npx vitest run src/core/settle.property.test.ts
const SEED = Number(process.env.DELIM_FC_SEED ?? 20261024)

/** Размах балансов: долги порядка состояния насыщения, но безопасные целые. */
const AMOUNT_LIMIT = 10 ** 12

/** Целые балансы 0..20 участников с Σ ровно 0: n−1 произвольных, последний — минус их сумма. */
const zeroSumAmounts: fc.Arbitrary<number[]> = fc.nat(20).chain((n) =>
  n === 0
    ? fc.constant([])
    : fc
        .array(fc.integer({ min: -AMOUNT_LIMIT, max: AMOUNT_LIMIT }), {
          minLength: n - 1,
          maxLength: n - 1,
        })
        .map((prefix) => [...prefix, -prefix.reduce((acc, value) => acc + value, 0)]),
)

/** Число участников с ненулевым балансом — порог гибрида считается по ним. */
function nonzeroCount(amounts: number[]): number {
  return amounts.filter((amount) => amount !== 0).length
}

function toBalances(amounts: number[]): BalanceEntry[] {
  return amounts.map((amount, i) => ({ participantId: `p${i + 1}`, amount }))
}

/** Булев аналог сверки: переводы строго положительны и гасят каждый баланс ровно в ноль. */
function settlesExactly(balances: BalanceEntry[], transfers: Transfer[]): boolean {
  const rest = new Map(balances.map((entry) => [entry.participantId, entry.amount]))
  for (const transfer of transfers) {
    if (!(transfer.amount > 0) || !Number.isInteger(transfer.amount)) return false
    rest.set(transfer.fromId, rest.get(transfer.fromId)! + transfer.amount)
    rest.set(transfer.toId, rest.get(transfer.toId)! - transfer.amount)
  }
  for (const amount of rest.values()) if (amount !== 0) return false
  return true
}

/**
 * Оракул жадного слоя — «максимальный должник гасится максимальным кредитором»,
 * тай-брейки по контракту из шапки settle.ts: по убыванию модуля остатка, при
 * равенстве — порядок в списке балансов. Написан здесь независимо от
 * приватного шва ./internal — поведенческая сверка без знания внутренностей.
 */
function greedyOracle(amounts: number[]): Transfer[] {
  const debtors: { id: string; rest: number; place: number }[] = []
  const creditors: { id: string; rest: number; place: number }[] = []
  amounts.forEach((amount, place) => {
    const rest = Math.abs(amount)
    if (amount < 0) debtors.push({ id: `p${place + 1}`, rest, place })
    else if (amount > 0) creditors.push({ id: `p${place + 1}`, rest, place })
  })
  const byRestDesc = (a: { rest: number; place: number }, b: { rest: number; place: number }) =>
    b.rest - a.rest || a.place - b.place
  debtors.sort(byRestDesc)
  creditors.sort(byRestDesc)

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].rest, creditors[j].rest)
    transfers.push({ fromId: debtors[i].id, toId: creditors[j].id, amount })
    debtors[i].rest -= amount
    creditors[j].rest -= amount
    if (debtors[i].rest === 0) i += 1
    if (creditors[j].rest === 0) j += 1
  }
  return transfers
}

describe('property-инварианты седения (случайные компании с Σ = 0)', () => {
  it('переводы гасят каждый баланс ровно в ноль и строго положительны', () => {
    fc.assert(
      fc.property(zeroSumAmounts, (amounts) => {
        const balances = toBalances(amounts)
        const transfers = settle(balances)
        expect(
          settlesExactly(balances, transfers),
          `балансы ${JSON.stringify(amounts)}, переводы ${JSON.stringify(transfers)}`,
        ).toBe(true)
      }),
      { seed: SEED, numRuns: 500 },
    )
  })

  it('переводов не больше, чем ненулевых участников − 1 (max(0, ·) для пустых)', () => {
    fc.assert(
      fc.property(zeroSumAmounts, (amounts) => {
        const transfers = settle(toBalances(amounts))
        const bound = Math.max(0, nonzeroCount(amounts) - 1)
        expect(
          transfers.length <= bound,
          `балансы ${JSON.stringify(amounts)}: ${transfers.length} переводов, порог ${bound}`,
        ).toBe(true)
      }),
      { seed: SEED, numRuns: 500 },
    )
  })

  it('при ≤ 12 ненулевых сведение не хуже жадного оракула по числу переводов', () => {
    fc.assert(
      fc.property(
        zeroSumAmounts.filter((amounts) => nonzeroCount(amounts) <= 12),
        (amounts) => {
          const transfers = settle(toBalances(amounts))
          const greedy = greedyOracle(amounts)
          expect(
            transfers.length <= greedy.length,
            `балансы ${JSON.stringify(amounts)}: сведение ${transfers.length}, жадный ${greedy.length}`,
          ).toBe(true)
        },
      ),
      { seed: SEED, numRuns: 400 },
    )
  })

  it('при 13..20 ненулевых сведение совпадает с жадным оракулом (за порогом ADR 0006)', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 13, max: 20 })
          .chain((n) =>
            fc
              .array(fc.integer({ min: -AMOUNT_LIMIT, max: AMOUNT_LIMIT }), {
                minLength: n - 1,
                maxLength: n - 1,
              })
              .map((prefix) => [...prefix, -prefix.reduce((acc, value) => acc + value, 0)]),
          )
          .filter((amounts) => nonzeroCount(amounts) >= 13),
        (amounts) => {
          expect(nonzeroCount(amounts)).toBeGreaterThanOrEqual(13)
          const transfers = settle(toBalances(amounts))
          const greedy = greedyOracle(amounts)
          expect(
            transfers,
            `балансы ${JSON.stringify(amounts)}`,
          ).toStrictEqual(greedy)
        },
      ),
      { seed: SEED, numRuns: 200 },
    )
  })
})

describe('property-край: порог гибрида считается по ненулевым, а не по всем участникам', () => {
  it('13+ участников, из которых ≤ 12 ненулевых — точный слой работает', () => {
    // Хвост ревью тикета 07: контрпример жадного [+4,−2,−2,+3,−3] (5 ненулевых,
    // минимум 3 перевода против 4 у жадного) + пара нулевых по сумме групп
    // {+1,−1} и {+2,−2} (ещё 4 ненулевых, итого 9) + четыре нулевых
    // баланса-пустышки до 13 участников. Порог ADR 0006 — по ненулевым (9 ≤ 12),
    // поэтому точный слой обязан запуститься и победить жадный: 9 − 4 = 5.
    const amounts = [4, -2, -2, 3, -3, 1, -1, 2, -2, 0, 0, 0, 0]
    const balances = toBalances(amounts)

    expect(nonzeroCount(amounts)).toBe(9)
    expect(amounts.length).toBeGreaterThanOrEqual(13)

    const greedy = greedyOracle(amounts)
    expect(greedy).toHaveLength(6)

    const transfers = settle(balances)
    expect(
      transfers.length,
      `переводы ${JSON.stringify(transfers)}`,
    ).toBeLessThan(greedy.length)
    expect(transfers).toHaveLength(5)
    expect(settlesExactly(balances, transfers)).toBe(true)
  })
})
