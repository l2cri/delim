import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import {
  SHARE_PAYLOAD_LIMIT,
  decodeTripState,
  encodeTripState,
  type DecodeResult,
  type TripDecodeError,
} from './codec'
import { SCHEMA_VERSION, createNewTrip, type TripState } from './schema'

const ISO = '2026-10-01T10:00:00.000Z'

/** Насыщенная поездка: все режимы сплита, completed, 3 валюты, юникод, большие суммы. */
function richState(): TripState {
  return {
    version: SCHEMA_VERSION,
    name: 'Тбилиси 🌅 2026',
    status: 'completed',
    baseCurrency: 'RUB',
    currencies: [
      { code: 'RUB', rate: { num: 1, den: 1 } },
      { code: 'GEL', rate: { num: 31, den: 2 } },
      { code: 'USD', rate: { num: 92, den: 1 } },
    ],
    participants: [
      { id: 'p1', name: 'Аня 🐻', color: '#10b981', emoji: '🐻' },
      { id: 'p2', name: 'Боря', color: '#f59e0b', emoji: '🐢' },
      { id: 'p3', name: 'Вика', color: '#3b82f6', emoji: '🦉' },
    ],
    expenses: [
      {
        id: 'e1',
        title: 'Такси в аэропорт ✈️',
        payerId: 'p1',
        amount: 900_719_925_474,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] },
      },
      {
        id: 'e2',
        title: 'Ужин',
        payerId: 'p2',
        amount: 123_456_789,
        currencyCode: 'GEL',
        createdAt: ISO,
        split: {
          mode: 'exact',
          shares: [
            { participantId: 'p1', amount: 98_765_432 },
            { participantId: 'p2', amount: 0 },
            { participantId: 'p3', amount: 24_691_357 },
          ],
        },
      },
      {
        id: 'e3',
        title: 'Сувениры 🎁',
        payerId: 'p3',
        amount: 1_000_000_000,
        currencyCode: 'USD',
        createdAt: ISO,
        split: {
          mode: 'shares',
          shares: [
            { participantId: 'p1', weight: 2_000_000 },
            { participantId: 'p3', weight: 1 },
          ],
        },
      },
    ],
    payments: [{ id: 'v1', fromId: 'p2', toId: 'p1', amount: 45_000_000_000, currencyCode: 'RUB' }],
  }
}

/** Кортежи валидной минимальной поездки — заготовка для ручной порчи в тестах. */
function validTripTuples(): unknown[] {
  return [
    SCHEMA_VERSION,
    'Поездка в Грузию',
    0,
    'RUB',
    [['RUB', 1, 1]],
    [
      ['p1', 'Аня 🐻', '#10b981', '🐻'],
      ['p2', 'Боря', '#f59e0b', '🐢'],
    ],
    [['e1', 'Такси', 'p1', 1500, 'RUB', ISO, [0, ['p1', 'p2']]]],
    [],
  ]
}

/** Кортежи → полезная нагрузка тем же путём, что и кодер. */
function payloadOf(tuples: unknown[]): string {
  return compressToEncodedURIComponent(JSON.stringify(tuples))
}

/** Тест ловит ровно свою причину отказа и не падает на narrowing-выходе. */
function expectFailed(result: DecodeResult, kind: TripDecodeError['kind']) {
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.kind).toBe(kind)
}

describe('roundtrip: encode → decode без потерь', () => {
  it('насыщенная поездка — тот же стейт, байт-в-байт', () => {
    const state = richState()
    const decoded = decodeTripState(encodeTripState(state))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.state).toEqual(state)
    // «Байт-в-байт»: развёрнутый объект совпадает со схемой и порядком ключей.
    expect(JSON.stringify(decoded.state)).toBe(JSON.stringify(state))
  })

  it('пустая поездка из createNewTrip', () => {
    const state = createNewTrip({ name: 'Выходные в Казани', baseCurrency: 'RUB' })
    expect(decodeTripState(encodeTripState(state))).toEqual({ ok: true, state })
  })
})

describe('encode: детерминированность', () => {
  it('два вызова на одном стейте — одна и та же строка', () => {
    const state = richState()
    expect(encodeTripState(state)).toBe(encodeTripState(state))
  })
})

describe('decode: пустая полезная нагрузка', () => {
  it('пустая строка → damaged «пустая полезная нагрузка»', () => {
    expect(decodeTripState('')).toEqual({ ok: false, error: { kind: 'damaged', detail: 'пустая полезная нагрузка' } })
  })

  it('только пробелы → damaged «пустая полезная нагрузка»', () => {
    expect(decodeTripState('   ')).toEqual({
      ok: false,
      error: { kind: 'damaged', detail: 'пустая полезная нагрузка' },
    })
  })
})

describe('decode: лимит длины на входе', () => {
  it('100 001 символ → too-long, max 100 000, actual 100 001', () => {
    const result = decodeTripState('a'.repeat(SHARE_PAYLOAD_LIMIT + 1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'too-long',
      max: SHARE_PAYLOAD_LIMIT,
      actual: SHARE_PAYLOAD_LIMIT + 1,
    })
  })

  it('ровно 100 000 символов — не too-long: граница «длиннее 100 000»', () => {
    const result = decodeTripState('a'.repeat(SHARE_PAYLOAD_LIMIT))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).not.toBe('too-long')
  })
})

describe('decode: повреждённая полезная нагрузка', () => {
  it('мусор не-lz-string → damaged', () => {
    expectFailed(decodeTripState('abc-def_ghi'), 'damaged')
  })

  it('обрезанная валидная ссылка → damaged', () => {
    const payload = encodeTripState(richState())
    expectFailed(decodeTripState(payload.slice(0, Math.floor(payload.length / 2))), 'damaged')
  })

  it('lz-string и JSON корректны, но это не кортежи → damaged с местом в detail', () => {
    const result = decodeTripState(compressToEncodedURIComponent('{"version":1}'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'damaged',
      detail: 'полезная нагрузка не в формате кортежей: trip',
    })
  })
})

describe('decode: причины parseTripState насквозь', () => {
  it('чужая версия схемы → version, found SCHEMA_VERSION + 1', () => {
    const tuples = validTripTuples()
    tuples[0] = SCHEMA_VERSION + 1
    const result = decodeTripState(payloadOf(tuples))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'version', found: SCHEMA_VERSION + 1 })
  })

  it('21 участник → limit participants, max 20, actual 21', () => {
    const tuples = validTripTuples()
    tuples[5] = Array.from({ length: 21 }, (_, i) => [`p${i + 1}`, `Участник ${i + 1}`, '#10b981', '🐻'])
    const result = decodeTripState(payloadOf(tuples))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'limit', limit: 'participants', max: 20, actual: 21 })
  })

  it('у расхода payerId «ghost» → references expense/payerId/ghost', () => {
    const tuples = validTripTuples()
    ;(tuples[6] as unknown[][])[0][2] = 'ghost'
    const result = decodeTripState(payloadOf(tuples))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense',
      field: 'payerId',
      missingId: 'ghost',
    })
  })
})
