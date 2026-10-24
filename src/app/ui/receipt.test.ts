import { describe, expect, it } from 'vitest'
import { createNewTrip } from '../../core'
import type { Participant, TripState } from '../../core'
import { buildReceipt } from './receipt'

const ISO = '2026-10-01T10:00:00.000Z'

/** Состав сида: тот же, что в дымах сведения (tests/helpers/smoke.ts). */
const PEOPLE: Participant[] = [
  { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
  { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
  { id: 'p3', name: 'Вика', color: '#d97706', emoji: '🦊' },
  { id: 'p4', name: 'Гоша', color: '#dc2626', emoji: '🐺' },
]

/** Свежая поездка «Кипр» (RUB) с довеской вызывающего — приём сидирования дымов. */
function trip(mutate: (state: TripState) => void = () => {}): TripState {
  const state = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  mutate(state)
  return state
}

/** Расход RUB поровну: «Аренда» за `amount` минорных, платит p1, делится между
 * участниками с индексами `who` (внутри PEOPLE). */
function expense(id: string, amount: number, who: number[], createdAt: string = ISO) {
  return {
    id,
    title: 'Аренда',
    payerId: 'p1',
    amount,
    currencyCode: 'RUB',
    createdAt,
    split: { mode: 'equal' as const, participantIds: who.map((i) => PEOPLE[i].id) },
  }
}

describe('квитанция целиком', () => {
  it('полная: шапка, счётчики и один фенс-блок с балансами и переводами', () => {
    // 1000,00 RUB поровну на троих (Аня — плательщица): Аня +666,66,
    // Боря и Вика по −333,33 (наибольший остаток — первой строке сплита), Гоша в нуле.
    const state = trip((s) => {
      s.participants.push(...PEOPLE)
      s.expenses.push(expense('e1', 100000, [0, 1, 2]))
    })

    expect(buildReceipt(state)).toBe(
      [
        'Делим · квитанция',
        '',
        'Поездка: Кипр',
        'Даты: 01.10.2026',
        'Участники: Аня, Боря, Вика, Гоша',
        'Расходов: 1 · Выплат: 0',
        '',
        '```',
        'Балансы · RUB',
        'Аня — должны ей 666,66',
        'Боря — должен 333,33',
        'Вика — должен 333,33',
        'Гоша — в нуле',
        '',
        'Переводы · RUB',
        'Боря → Аня 333,33',
        'Вика → Аня 333,33',
        '```',
      ].join('\n'),
    )
  })

  it('участники без расходов: все «в нуле», строк «Даты» и «Расходов» нет', () => {
    const state = trip((s) => {
      s.participants.push(PEOPLE[0], PEOPLE[1])
    })

    const receipt = buildReceipt(state)
    expect(receipt).toContain('Участники: Аня, Боря')
    expect(receipt).not.toContain('Даты:')
    expect(receipt).not.toContain('Расходов:')
    expect(receipt).toContain('Аня — в нуле')
    expect(receipt).toContain('Боря — в нуле')
    expect(receipt).toContain('Переводов нет — все в нуле')
  })

  it('пустая поездка: объяснение вместо блоков, фенсов нет', () => {
    const receipt = buildReceipt(trip())

    expect(receipt).toBe(
      [
        'Делим · квитанция',
        '',
        'Поездка: Кипр',
        '',
        'Участников и расходов пока нет.',
        'Балансы и переводы появятся, когда добавите участников и расходы.',
      ].join('\n'),
    )
    expect(receipt).not.toContain('```')
  })
})

describe('даты поездки', () => {
  it('диапазон min—max по дням создания расходов', () => {
    const state = trip((s) => {
      s.participants.push(PEOPLE[0], PEOPLE[1])
      s.expenses.push(expense('e1', 1000, [0, 1], '2026-10-03T09:00:00.000Z'))
      s.expenses.push(expense('e2', 2000, [0, 1], '2026-10-01T21:00:00.000Z'))
    })

    expect(buildReceipt(state)).toContain('Даты: 01.10.2026 — 03.10.2026')
  })

  it('совпадающий день — одна дата без тире', () => {
    const state = trip((s) => {
      s.participants.push(PEOPLE[0], PEOPLE[1])
      s.expenses.push(expense('e1', 1000, [0, 1], '2026-10-05T09:00:00.000Z'))
      s.expenses.push(expense('e2', 2000, [0, 1], '2026-10-05T21:00:00.000Z'))
    })

    const dateLine = buildReceipt(state).split('\n').find((line) => line.startsWith('Даты:'))
    expect(dateLine).toBe('Даты: 05.10.2026')
  })
})

describe('строки балансов и переводов', () => {
  it('длинное имя целиком в строке, без добивки — строка оканчивается суммой', () => {
    const longName = 'Анна-Мария-Виктория-Екатерина-Елизавета-Александра'
    expect(longName.length).toBeGreaterThanOrEqual(40)
    // 2500,00 RUB поровну на двоих, платит длинноимянная: баланс +1 250,00 (U+00A0).
    const state = trip((s) => {
      s.participants.push({ ...PEOPLE[0], name: longName }, PEOPLE[1])
      s.expenses.push(expense('e1', 250000, [0, 1]))
    })

    const receipt = buildReceipt(state)
    const balanceLine = receipt.split('\n').find((line) => line.startsWith(longName))
    expect(balanceLine).toBe(`${longName} — должны ей 1\u00A0250,00`)
    expect(balanceLine?.endsWith('1\u00A0250,00')).toBe(true)
  })

  it('мультивалютность: расход 100,00 EUR по курсу 3/1 — суммы в базовом RUB', () => {
    const state = trip((s) => {
      s.currencies.push({ code: 'EUR', rate: { num: 3, den: 1 } })
      s.participants.push(PEOPLE[0], PEOPLE[1])
      s.expenses.push({
        ...expense('e1', 10000, [0, 1]),
        currencyCode: 'EUR', // 100,00 EUR × 3 = 300,00 RUB → по 150,00 каждой стороне
      })
    })

    const receipt = buildReceipt(state)
    expect(receipt).toContain('Балансы · RUB')
    expect(receipt).toContain('Аня — должны ей 150,00')
    expect(receipt).toContain('Боря — должен 150,00')
    expect(receipt).toContain('Боря → Аня 150,00')
  })

  it('выплата учтена: перевод Бори исчез, осталась Вика → Аня', () => {
    const state = trip((s) => {
      s.participants.push(...PEOPLE)
      s.expenses.push(expense('e1', 100000, [0, 1, 2]))
      s.payments.push({ id: 'pay1', fromId: 'p2', toId: 'p1', amount: 33333, currencyCode: 'RUB' })
    })

    const receipt = buildReceipt(state)
    expect(receipt).toContain('Расходов: 1 · Выплат: 1')
    expect(receipt).toContain('Аня — должны ей 333,33')
    expect(receipt).toContain('Боря — в нуле')
    expect(receipt).toContain('Вика — должен 333,33')
    expect(receipt).toContain('Вика → Аня 333,33')
    expect(receipt).not.toContain('Боря →')
  })
})
