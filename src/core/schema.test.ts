import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  createNewTrip,
  parseTripState,
  type TripState,
} from './schema'

const ISO = '2026-10-01T10:00:00.000Z'

function buildValidState(): TripState {
  return {
    version: 1,
    name: 'Поездка в Грузию',
    status: 'active',
    baseCurrency: 'RUB',
    currencies: [
      { code: 'RUB', rate: { num: 1, den: 1 } },
      { code: 'USD', rate: { num: 92, den: 1 } },
      { code: 'GEL', rate: { num: 31, den: 2 } },
    ],
    participants: [
      { id: 'p1', name: 'Аня', color: '#10b981', emoji: '🦊' },
      { id: 'p2', name: 'Боря', color: '#f59e0b', emoji: '🐢' },
      { id: 'p3', name: 'Вика', color: '#3b82f6', emoji: '🦉' },
    ],
    expenses: [
      {
        id: 'e1',
        title: 'Такси',
        payerId: 'p1',
        amount: 150000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] },
      },
      {
        id: 'e2',
        title: 'Ужин',
        payerId: 'p2',
        amount: 8500,
        currencyCode: 'GEL',
        createdAt: ISO,
        split: {
          mode: 'exact',
          shares: [
            { participantId: 'p1', amount: 3000 },
            { participantId: 'p2', amount: 3000 },
            { participantId: 'p3', amount: 2500 },
          ],
        },
      },
      {
        id: 'e3',
        title: 'Сувениры',
        payerId: 'p3',
        amount: 4200,
        currencyCode: 'USD',
        createdAt: ISO,
        split: {
          mode: 'shares',
          shares: [
            { participantId: 'p1', weight: 2 },
            { participantId: 'p3', weight: 1 },
          ],
        },
      },
    ],
    payments: [
      { id: 'v1', fromId: 'p2', toId: 'p1', amount: 50000, currencyCode: 'RUB' },
    ],
  }
}

/** Валидный стейт + одно точечное изменение → JSON. Тест ловит ровно свою причину отказа. */
function jsonWithFault(apply: (state: TripState) => void): string {
  const state = buildValidState()
  apply(state)
  return JSON.stringify(state)
}

function participants(n: number): TripState['participants'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Участник ${i + 1}`,
    color: '#10b981',
    emoji: '🦊',
  }))
}

function expenses(n: number): TripState['expenses'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i + 1}`,
    title: `Расход ${i + 1}`,
    payerId: 'p1',
    amount: 100 + i,
    currencyCode: 'RUB',
    createdAt: ISO,
    split: { mode: 'equal', participantIds: ['p1'] },
  }))
}

function payments(n: number): TripState['payments'] {
  return Array.from({ length: n }, (_, i) => ({
    id: `v${i + 1}`,
    fromId: 'p1',
    toId: 'p2',
    amount: 100 + i,
    currencyCode: 'RUB',
  }))
}

function currencies(n: number): TripState['currencies'] {
  // Первая — базовая RUB 1/1, остальные — уникальные коды с любым валидным курсом.
  return Array.from({ length: n }, (_, i) => ({
    code: i === 0 ? 'RUB' : `C${i}`,
    rate: { num: 1, den: 1 },
  }))
}

function jsonTrip(overrides: Partial<TripState>): string {
  return JSON.stringify({
    version: 1,
    name: 'Тест',
    status: 'active',
    baseCurrency: 'RUB',
    currencies: currencies(1),
    participants: participants(2),
    expenses: [],
    payments: [],
    ...overrides,
  })
}

function expectRejected(raw: string, kind: 'damaged' | 'version' | 'references') {
  const result = parseTripState(raw)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.kind).toBe(kind)
}

describe('createNewTrip', () => {
  it('собирает валидную новую поездку: активна, базовая валюта 1/1, списки пусты', () => {
    expect(createNewTrip({ name: 'Кипр-2027', baseCurrency: 'RUB' })).toEqual({
      version: SCHEMA_VERSION,
      name: 'Кипр-2027',
      status: 'active',
      baseCurrency: 'RUB',
      currencies: [{ code: 'RUB', rate: { num: 1, den: 1 } }],
      participants: [],
      expenses: [],
      payments: [],
    })
  })

  it('обрезает пробелы по краям названия и кода валюты', () => {
    const trip = createNewTrip({ name: '  Кипр  ', baseCurrency: '  EUR ' })
    expect(trip.name).toBe('Кипр')
    expect(trip.baseCurrency).toBe('EUR')
  })

  it('отвергает пустое название', () => {
    expect(() => createNewTrip({ name: '   ', baseCurrency: 'RUB' })).toThrow()
    expect(() => createNewTrip({ name: '', baseCurrency: 'RUB' })).toThrow()
  })

  it('отвергает пустую базовую валюту', () => {
    expect(() => createNewTrip({ name: 'Кипр', baseCurrency: ' ' })).toThrow()
    expect(() => createNewTrip({ name: 'Кипр', baseCurrency: '' })).toThrow()
  })
})

describe('roundtrip: сериализация без потерь', () => {
  it('новая поездка проходит create → JSON → parse без изменений', () => {
    const trip = createNewTrip({ name: 'Выходные в Казани', baseCurrency: 'RUB' })
    expect(parseTripState(JSON.stringify(trip))).toEqual({ ok: true, state: trip })
  })

  it('полностью заполненный стейт (все режимы сплита, валюты, выплаты) проходит без потерь', () => {
    const state = buildValidState()
    expect(parseTripState(JSON.stringify(state))).toEqual({ ok: true, state })
  })
})

describe('parseTripState: валидные стейты', () => {
  it('принимает новую пустую поездку', () => {
    const raw = JSON.stringify(createNewTrip({ name: 'Т', baseCurrency: 'RUB' }))
    expect(parseTripState(raw).ok).toBe(true)
  })

  it('принимает заполненный стейт', () => {
    expect(parseTripState(JSON.stringify(buildValidState())).ok).toBe(true)
  })

  it('принимает exact-долю с нулевой суммой — «кто не пил, но ел»', () => {
    const raw = jsonWithFault((s) => {
      s.expenses = [
        {
          id: 'e9',
          title: 'Шашлык',
          payerId: 'p1',
          amount: 1000,
          currencyCode: 'RUB',
          createdAt: ISO,
          split: {
            mode: 'exact',
            shares: [
              { participantId: 'p1', amount: 1000 },
              { participantId: 'p2', amount: 0 },
            ],
          },
        },
      ]
    })
    expect(parseTripState(raw).ok).toBe(true)
  })
})

describe('parseTripState: повреждённый стейт (kind damaged)', () => {
  it('не-JSON строка', () => {
    expectRejected('это не json', 'damaged')
  })

  it('JSON-массив вместо объекта', () => {
    expectRejected('[]', 'damaged')
  })

  it('null', () => {
    expectRejected('null', 'damaged')
  })

  it('строковое значение вместо объекта', () => {
    expectRejected('"поездка"', 'damaged')
  })

  it('пропущено обязательное поле', () => {
    expectRejected(jsonWithFault((s) => { delete (s as Partial<TripState>).name }), 'damaged')
  })

  it('сумма расхода — строка вместо числа', () => {
    expectRejected(jsonWithFault((s) => { (s.expenses[0] as { amount: unknown }).amount = '150000' }), 'damaged')
  })

  it('сумма расхода дробная', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[0].amount = 150.5 }), 'damaged')
  })

  it('сумма расхода нулевая', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[0].amount = 0 }), 'damaged')
  })

  it('сумма расхода отрицательная', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[0].amount = -1 }), 'damaged')
  })

  it('сумма расхода за пределами безопасных целых', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[0].amount = 1e21 }), 'damaged')
  })

  it('вес доли нулевой', () => {
    expectRejected(jsonWithFault((s) => {
      if (s.expenses[2].split.mode === 'shares') s.expenses[2].split.shares[0].weight = 0
    }), 'damaged')
  })

  it('знаменатель курса нулевой', () => {
    expectRejected(jsonWithFault((s) => { s.currencies[1].rate.den = 0 }), 'damaged')
  })

  it('курс отрицательный', () => {
    expectRejected(jsonWithFault((s) => { s.currencies[1].rate.num = -92 }), 'damaged')
  })

  it('дубликат id участника', () => {
    expectRejected(jsonWithFault((s) => { s.participants[1].id = 'p1' }), 'damaged')
  })

  it('дубликат id расхода', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[1].id = 'e1' }), 'damaged')
  })

  it('дубликат id выплаты', () => {
    expectRejected(jsonWithFault((s) => {
      s.payments.push({ id: 'v2', fromId: 'p3', toId: 'p1', amount: 1000, currencyCode: 'RUB' })
      s.payments[1].id = 'v1'
    }), 'damaged')
  })

  it('дубликат кода валюты', () => {
    expectRejected(jsonWithFault((s) => { s.currencies[1].code = 'RUB' }), 'damaged')
  })

  it('базовой валюты нет в списке валют', () => {
    expectRejected(jsonWithFault((s) => { s.currencies = s.currencies.filter((c) => c.code !== 'RUB') }), 'damaged')
  })

  it('курс базовой валюты не 1/1', () => {
    expectRejected(jsonWithFault((s) => { s.currencies[0].rate = { num: 2, den: 1 } }), 'damaged')
  })

  it('пустой participantIds в сплите поровну', () => {
    expectRejected(jsonWithFault((s) => { s.expenses[0].split = { mode: 'equal', participantIds: [] } }), 'damaged')
  })

  it('дубликат участника в сплите поровну', () => {
    expectRejected(jsonWithFault((s) => {
      s.expenses[0].split = { mode: 'equal', participantIds: ['p1', 'p1'] }
    }), 'damaged')
  })

  it('дубликат участника в точных суммах', () => {
    expectRejected(jsonWithFault((s) => {
      s.expenses[1].split = {
        mode: 'exact',
        shares: [
          { participantId: 'p1', amount: 500 },
          { participantId: 'p1', amount: 500 },
        ],
      }
    }), 'damaged')
  })

  it('дубликат участника в долях', () => {
    expectRejected(jsonWithFault((s) => {
      s.expenses[2].split = {
        mode: 'shares',
        shares: [
          { participantId: 'p1', weight: 2 },
          { participantId: 'p1', weight: 1 },
        ],
      }
    }), 'damaged')
  })

  it('выплата самому себе', () => {
    expectRejected(jsonWithFault((s) => { s.payments[0].toId = 'p2' }), 'damaged')
  })

  it('неизвестное поле верхнего уровня', () => {
    expectRejected(jsonWithFault((s) => {
      (s as unknown as Record<string, unknown>).surprise = true
    }), 'damaged')
  })
})

describe('parseTripState: версия схемы', () => {
  it('version: 2 → причина version, found 2', () => {
    const raw = JSON.stringify({ ...buildValidState(), version: 2 })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'version', found: 2 })
  })

  it('version: 0 → причина version', () => {
    const raw = JSON.stringify({ ...buildValidState(), version: 0 })
    expectRejected(raw, 'version')
  })

  it('version строкой «1» → причина version', () => {
    const raw = JSON.stringify({ ...buildValidState(), version: '1' })
    expectRejected(raw, 'version')
  })

  it('version отсутствует → damaged, а не version', () => {
    expectRejected(jsonWithFault((s) => { delete (s as Partial<TripState>).version }), 'damaged')
  })
})

describe('parseTripState: лимиты', () => {
  it('ровно 20 участников проходит', () => {
    expect(parseTripState(jsonTrip({ participants: participants(20) })).ok).toBe(true)
  })

  it('21 участник → limit participants, max 20, actual 21', () => {
    const result = parseTripState(jsonTrip({ participants: participants(21) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'limit', limit: 'participants', max: 20, actual: 21 })
  })

  it('ровно 300 расходов проходит', () => {
    expect(parseTripState(jsonTrip({ expenses: expenses(300) })).ok).toBe(true)
  })

  it('301 расход → limit expenses', () => {
    const result = parseTripState(jsonTrip({ expenses: expenses(301) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'limit', limit: 'expenses', max: 300, actual: 301 })
  })

  it('ровно 200 выплат проходит', () => {
    expect(parseTripState(jsonTrip({ payments: payments(200) })).ok).toBe(true)
  })

  it('201 выплата → limit payments', () => {
    const result = parseTripState(jsonTrip({ payments: payments(201) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'limit', limit: 'payments', max: 200, actual: 201 })
  })

  it('ровно 10 валют проходит', () => {
    expect(parseTripState(jsonTrip({ currencies: currencies(10) })).ok).toBe(true)
  })

  it('11 валют → limit currencies', () => {
    const result = parseTripState(jsonTrip({ currencies: currencies(11) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'limit', limit: 'currencies', max: 10, actual: 11 })
  })
})

describe('parseTripState: референциальная целостность', () => {
  it('плательщик не существует', () => {
    const raw = jsonWithFault((s) => { s.expenses[0].payerId = 'ghost' })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense',
      field: 'payerId',
      missingId: 'ghost',
    })
  })

  it('валюта расхода не существует', () => {
    const raw = jsonWithFault((s) => { s.expenses[0].currencyCode = 'GBP' })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense',
      field: 'currencyCode',
      missingId: 'GBP',
    })
  })

  it('участник сплита поровну не существует', () => {
    const raw = jsonWithFault((s) => {
      s.expenses[0].split = { mode: 'equal', participantIds: ['p1', 'ghost'] }
    })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense.split',
      field: 'participantId',
      missingId: 'ghost',
    })
  })

  it('участник точных сумм не существует', () => {
    const raw = jsonWithFault((s) => {
      s.expenses[1].split = {
        mode: 'exact',
        shares: [{ participantId: 'ghost', amount: 8500 }],
      }
    })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense.split',
      field: 'participantId',
      missingId: 'ghost',
    })
  })

  it('участник долей не существует', () => {
    const raw = jsonWithFault((s) => {
      s.expenses[2].split = {
        mode: 'shares',
        shares: [{ participantId: 'ghost', weight: 3 }],
      }
    })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'expense.split',
      field: 'participantId',
      missingId: 'ghost',
    })
  })

  it('отправитель выплаты не существует', () => {
    const raw = jsonWithFault((s) => { s.payments[0].fromId = 'ghost' })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'payment',
      field: 'fromId',
      missingId: 'ghost',
    })
  })

  it('получатель выплаты не существует', () => {
    const raw = jsonWithFault((s) => { s.payments[0].toId = 'ghost' })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'payment',
      field: 'toId',
      missingId: 'ghost',
    })
  })

  it('валюта выплаты не существует', () => {
    const raw = jsonWithFault((s) => { s.payments[0].currencyCode = 'GBP' })
    const result = parseTripState(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'references',
      entity: 'payment',
      field: 'currencyCode',
      missingId: 'GBP',
    })
  })
})
