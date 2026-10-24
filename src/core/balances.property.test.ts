import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeBalances } from './balances'
import { SCHEMA_VERSION, parseTripState, type Rational, type Split, type TripState } from './schema'

// Property-слой гроссбуха: случайные валидные поездки → инварианты денег
// «не возникают и не исчезают»: Σ балансов ровно ноль, все балансы — целые
// минорные единицы базовой валюты. Сериализация сгенерированного стейта
// обязана проходить parseTripState — генератор строит ровно валидные стейты
// и потому же пригоден как задел под кодек-roundtrip тикета 15.

// Единый сид тикета: прогоны детерминированы, падение воспроизводимо.
// Другой сид: DELIM_FC_SEED=12345 npx vitest run src/core/balances.property.test.ts
const SEED = Number(process.env.DELIM_FC_SEED ?? 20261024)

const ISO = '2026-10-01T10:00:00.000Z'

/** Курсы чужих валют: точные рациональные num/den из [1..10^6] каждая. */
const rateArb: fc.Arbitrary<Rational> = fc.record({
  num: fc.integer({ min: 1, max: 10 ** 6 }),
  den: fc.integer({ min: 1, max: 10 ** 6 }),
})

/**
 * Сплит по непустому подмножеству участников: режим equal/shares/exact по
 * схеме; веса и введённые суммы генерируются ровно по числу выбранных,
 * поэтому стейт собирается валидным без пост-фильтрации.
 */
function splitArb(ids: string[]): fc.Arbitrary<Split> {
  return fc
    .uniqueArray(fc.nat({ max: ids.length - 1 }), {
      minLength: 1,
      maxLength: ids.length,
    })
    .chain((indices) => {
      const chosen = indices.map((i) => ids[i])
      return fc.constantFrom<'equal' | 'shares' | 'exact'>('equal', 'shares', 'exact').chain(
        (mode): fc.Arbitrary<Split> => {
          if (mode === 'equal') {
            return fc.constant({ mode: 'equal', participantIds: chosen })
          }
          if (mode === 'shares') {
            return fc
              .array(fc.integer({ min: 1, max: 10 ** 6 }), {
                minLength: chosen.length,
                maxLength: chosen.length,
              })
              .map((weights) => ({
                mode: 'shares',
                shares: chosen.map((participantId, i) => ({ participantId, weight: weights[i] })),
              }))
          }
          return fc
            .array(fc.integer({ min: 0, max: 10 ** 9 }), {
              minLength: chosen.length,
              maxLength: chosen.length,
            })
            .map((amounts) => ({
              mode: 'exact',
              shares: chosen.map((participantId, i) => ({ participantId, amount: amounts[i] })),
            }))
        },
      )
    })
}

/** Упорядоченная пара различных участников — fromId ≠ toId по схеме выплат. */
function distinctPairArb(ids: string[]): fc.Arbitrary<{ from: string; to: string }> {
  return fc
    .tuple(fc.nat(ids.length - 1), fc.nat(ids.length - 1))
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => ({ from: ids[a], to: ids[b] }))
}

/**
 * Генератор валидного TripState: 1..12 участников, 1..4 валюты (первая —
 * базовая RUB с курсом ровно 1/1, остальные — случайные точные рациональные),
 * 0..15 расходов (payer и участники сплита — из сгенерированных, суммы ≤ 10^9)
 * и 0..5 выплат. Все ссылки и уникальность ids выполнены по построению —
 * расходом на генератор: если он собрал невалидный стейт, первый же
 * property (parseTripState) падает с полным JSON контрпримером.
 */
const tripArb: fc.Arbitrary<TripState> = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 3 }))
  .chain(([participantCount, extraCount]) => {
    const ids = Array.from({ length: participantCount }, (_, i) => `p${i + 1}`)
    const currencyCodes = ['RUB', ...Array.from({ length: extraCount }, (_, i) => `C${i + 1}`)]
    return fc
      .record({
        extraRates: fc.array(rateArb, { minLength: extraCount, maxLength: extraCount }),
        expenses: fc.array(
          fc.record({
            split: splitArb(ids),
            payerIndex: fc.nat(participantCount - 1),
            amount: fc.integer({ min: 1, max: 10 ** 9 }),
            currencyIndex: fc.nat(currencyCodes.length - 1),
          }),
          { maxLength: 15 },
        ),
        payments:
          participantCount >= 2
            ? fc.array(
                fc.record({
                  pair: distinctPairArb(ids),
                  amount: fc.integer({ min: 1, max: 10 ** 9 }),
                  currencyIndex: fc.nat(currencyCodes.length - 1),
                }),
                { maxLength: 5 },
              )
            : fc.constant([]),
      })
      .map(({ extraRates, expenses, payments }) => ({
        version: SCHEMA_VERSION,
        name: 'Генеративная',
        status: 'active' as const,
        baseCurrency: 'RUB',
        currencies: [
          { code: 'RUB', rate: { num: 1, den: 1 } },
          ...extraRates.map((rate, i) => ({ code: `C${i + 1}`, rate })),
        ],
        participants: ids.map((id, i) => ({
          id,
          name: `Участник ${i + 1}`,
          color: '#10b981',
          emoji: '🦊',
        })),
        expenses: expenses.map((expense, i) => ({
          id: `e${i + 1}`,
          title: `Расход ${i + 1}`,
          payerId: ids[expense.payerIndex],
          amount: expense.amount,
          currencyCode: currencyCodes[expense.currencyIndex],
          createdAt: ISO,
          split: expense.split,
        })),
        payments: payments.map((payment, i) => ({
          id: `pay${i + 1}`,
          fromId: payment.pair.from,
          toId: payment.pair.to,
          amount: payment.amount,
          currencyCode: currencyCodes[payment.currencyIndex],
        })),
      }))
  })

describe('property-инварианты денег на случайных поездках', () => {
  it('генератор строит ровно валидные стейты: parseTripState принимает сериализованный trip', () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        // Сравнение — с JSON-значением стейта (roundtrip-семантика кодека):
        // fast-check строит объекты с null-прототипом, toStrictEqual различает
        // прототипы, а JSON.parse выравнивает всё до обычных объектов.
        const json = JSON.stringify(trip)
        const result = parseTripState(json)
        expect(result, json).toStrictEqual({ ok: true, state: JSON.parse(json) })
      }),
      { seed: SEED, numRuns: 200 },
    )
  })

  it('Σ балансов ровно ноль и все балансы — целые (деньги не возникают и не исчезают)', () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const balances = computeBalances(trip)
        const sum = balances.reduce((acc, entry) => acc + entry.amount, 0)
        expect(
          sum,
          `балансы ${JSON.stringify(balances)} поездки ${JSON.stringify(trip)}`,
        ).toBe(0)
        for (const entry of balances) {
          expect(Number.isInteger(entry.amount), JSON.stringify(trip)).toBe(true)
        }
      }),
      { seed: SEED, numRuns: 200 },
    )
  })
})
