import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeTripState, encodeTripState } from './codec'
import {
  SCHEMA_VERSION,
  type Currency,
  type Expense,
  type Payment,
  type Split,
  type TripState,
} from './schema'

// Property-слой кодека (ADR 0007): roundtrip без потерь на случайных валидных
// поездках — encode → decode возвращает тот же стейт, юникод и большие суммы
// переживают кортежи и lz-string. Генератор ограничен ради скорости (≤6
// участников, ≤8 расходов, ≤4 выплаты, ≤3 валюты) — формат от размеров не
// зависит, лимиты схемы покрывают краевыми тестами codec.test.ts.

// Единый сид тикета: прогоны детерминированы, падение воспроизводимо.
// Другой сид: DELIM_FC_SEED=12345 npx vitest run src/core/codec.property.test.ts
const SEED = Number(process.env.DELIM_FC_SEED ?? 20261024)

/** Пул символов строк: кириллица, эмодзи, латиница, цифры и пробел — как в живых данных. */
const CHARS = ['А', 'я', 'Ё', 'щ', 'b', 'Q', '7', ' ', '-', '🐻', '🦊', '🐢', '🌅', '🎉'] as const

/** Непустая юникод-строка из пула. */
const textArb = fc
  .array(fc.constantFrom(...CHARS), { minLength: 1, maxLength: 10 })
  .map((chars) => chars.join(''))

/** Суммы — положительные безопасные целые; веса и курсы — из диапазона схемы. */
const amountArb = fc.integer({ min: 1, max: 10 ** 12 })
const weightArb = fc.integer({ min: 1, max: 10 ** 6 })
const rateArb = fc.record({
  num: fc.integer({ min: 1, max: 10 ** 6 }),
  den: fc.integer({ min: 1, max: 10 ** 6 }),
})

/** createdAt — целые мс 2024–2028 годов, приведённые к ISO-строке схемы. */
const createdAtArb = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2028, 11, 31) })
  .map((ms) => new Date(ms).toISOString())

const PALETTE = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444'] as const
const EMOJIS = ['🦊', '🐢', '🦉', '🐻'] as const

/** 1..6 участников: уникальные id, случайные юникод-имена, палитра цвета и эмодзи. */
const participantsArb = fc
  .integer({ min: 1, max: 6 })
  .chain((k) =>
    fc.array(textArb, { minLength: k, maxLength: k }).map((names) =>
      names.map((name, i) => ({
        id: `p${i + 1}`,
        name,
        color: PALETTE[i % PALETTE.length],
        emoji: EMOJIS[i % EMOJIS.length],
      })),
    ),
  )

/** Сплит любого режима по непустому подмножеству участников: id уникальны по построению. */
function splitArb(ids: string[]): fc.Arbitrary<Split> {
  const equalArb: fc.Arbitrary<Split> = fc
    .shuffledSubarray(ids, { minLength: 1 })
    .map((participantIds) => ({ mode: 'equal', participantIds }))
  const exactArb: fc.Arbitrary<Split> = fc
    .shuffledSubarray(ids, { minLength: 1 })
    .chain((chosen) =>
      fc
        .array(fc.integer({ min: 0, max: 10 ** 12 }), { minLength: chosen.length, maxLength: chosen.length })
        .map((amounts) => ({
          mode: 'exact',
          shares: chosen.map((participantId, i) => ({ participantId, amount: amounts[i] })),
        })),
    )
  const sharesArb: fc.Arbitrary<Split> = fc
    .shuffledSubarray(ids, { minLength: 1 })
    .chain((chosen) =>
      fc
        .array(weightArb, { minLength: chosen.length, maxLength: chosen.length })
        .map((weights) => ({
          mode: 'shares',
          shares: chosen.map((participantId, i) => ({ participantId, weight: weights[i] })),
        })),
    )
  return fc.constantFrom(equalArb, exactArb, sharesArb).chain((arb) => arb)
}

/** ≤8 расходов по данным участникам и валютам; id назначаются по индексу — уникальны. */
function expensesArb(ids: string[], codes: string[]): fc.Arbitrary<Expense[]> {
  const expenseArb = fc.record({
    title: textArb,
    payerId: fc.constantFrom(...ids),
    amount: amountArb,
    currencyCode: fc.constantFrom(...codes),
    createdAt: createdAtArb,
    split: splitArb(ids),
  })
  return fc.array(expenseArb, { maxLength: 8 }).map((expenses) =>
    expenses.map(({ title, payerId, amount, currencyCode, createdAt, split }, i) => ({
      id: `e${i + 1}`,
      title,
      payerId,
      amount,
      currencyCode,
      createdAt,
      split,
    })),
  )
}

/** ≤4 выплат; отправитель ≠ получатель — берём два разных id подвыборкой (при одном участнике выплат нет). */
function paymentsArb(ids: string[], codes: string[]): fc.Arbitrary<Payment[]> {
  if (ids.length < 2) return fc.constant([])
  const paymentArb = fc.record({
    pair: fc.shuffledSubarray(ids, { minLength: 2, maxLength: 2 }),
    amount: amountArb,
    currencyCode: fc.constantFrom(...codes),
  })
  return fc.array(paymentArb, { maxLength: 4 }).map((payments) =>
    payments.map(({ pair, amount, currencyCode }, i) => ({
      id: `v${i + 1}`,
      fromId: pair[0],
      toId: pair[1],
      amount,
      currencyCode,
    })),
  )
}

/** Валидная поездка: базовая валюта — первая, курс 1/1; коды уникальны префиксами R/X и индексом. */
const tripArb: fc.Arbitrary<TripState> = fc
  .tuple(textArb, textArb, fc.constantFrom<'active' | 'completed'>('active', 'completed'), participantsArb)
  .chain(([name, baseCode, status, participants]) =>
    fc.array(fc.tuple(textArb, rateArb), { maxLength: 2 }).chain((foreign) => {
      const currencies: Currency[] = [
        { code: `R${baseCode}`, rate: { num: 1, den: 1 } },
        ...foreign.map(([code, rate], i) => ({ code: `X${i}${code}`, rate })),
      ]
      const codes = currencies.map((currency) => currency.code)
      const ids = participants.map((participant) => participant.id)
      return fc
        .tuple(expensesArb(ids, codes), paymentsArb(ids, codes))
        .map(([expenses, payments]): TripState => ({
          version: SCHEMA_VERSION,
          name,
          status,
          baseCurrency: currencies[0].code,
          currencies,
          participants,
          expenses,
          payments,
        }))
    }),
  )

describe('property-инварианты кодека', () => {
  it('roundtrip без потерь: decode(encode(s)) ок и стейт равен исходному', () => {
    fc.assert(
      fc.property(tripArb, (state) => {
        const payload = encodeTripState(state)
        const result = decodeTripState(payload)
        const context = `стейт ${JSON.stringify(state)}, полезная нагрузка ${payload}`
        expect(result.ok, context).toBe(true)
        if (!result.ok) return
        expect(result.state, context).toEqual(state)
      }),
      { seed: SEED, numRuns: 300 },
    )
  })
})
