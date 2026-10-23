import { describe, expect, it } from 'vitest'
import { createNewTrip, type Split, type TripState } from './schema'
import { computeBalances, type BalanceEntry } from './balances'
import { convertToBase, splitAmounts } from './splits'

const ISO = '2026-10-01T10:00:00.000Z'

/** Первые k участников. */
function ids(k: number): string[] {
  return Array.from({ length: k }, (_, i) => `p${i + 1}`)
}

/** Мини-стейт: плательщик p0 вне сплита, единственный расход в базовой валюте. */
function buildState(amount: number, split: Split): TripState {
  const state = createNewTrip({ name: 'Согласованность', baseCurrency: 'RUB' })
  state.participants.push(
    { id: 'p0', name: 'Плательщик', color: '#10b981', emoji: '🦊' },
    { id: 'p1', name: 'Аня', color: '#f59e0b', emoji: '🐢' },
    { id: 'p2', name: 'Боря', color: '#3b82f6', emoji: '🦉' },
    { id: 'p3', name: 'Вика', color: '#ef4444', emoji: '🐺' },
  )
  state.expenses.push({
    id: 'e1',
    title: 'Ужин',
    payerId: 'p0',
    amount,
    currencyCode: 'RUB',
    createdAt: ISO,
    split,
  })
  return state
}

/** Балансы как отображение «участник → сумма». */
function byId(entries: BalanceEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.participantId, e.amount]))
}

/** Суммы долей по порядку. */
function values(shares: readonly { amount: number }[]): number[] {
  return shares.map((share) => share.amount)
}

describe('операция «разбиение сплита» (splits)', () => {
  describe('equal — поровну, наибольшие остатки', () => {
    it('100,00 на троих: копейка первому по порядку participantIds', () => {
      const result = splitAmounts(10000, { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] })
      expect(result).toEqual([
        { participantId: 'p1', amount: 3334 },
        { participantId: 'p2', amount: 3333 },
        { participantId: 'p3', amount: 3333 },
      ])
    })

    it('1,01 на двоих: 0,51 и 0,50', () => {
      const result = splitAmounts(101, { mode: 'equal', participantIds: ['p1', 'p2'] })
      expect(values(result)).toEqual([51, 50])
    })

    it('0,02 на троих: первым двум по копейке, третий без доли', () => {
      const result = splitAmounts(2, { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] })
      expect(values(result)).toEqual([1, 1, 0])
    })

    it('равные дробные части: копейки первым по порядку, а не по алфавиту id', () => {
      // 0,02 на четверых — у всех ровно 0,005
      const result = splitAmounts(2, {
        mode: 'equal',
        participantIds: ['p3', 'p1', 'p2', 'p4'],
      })
      expect(result).toEqual([
        { participantId: 'p3', amount: 1 },
        { participantId: 'p1', amount: 1 },
        { participantId: 'p2', amount: 0 },
        { participantId: 'p4', amount: 0 },
      ])
    })
  })

  describe('shares — пропорционально весам', () => {
    it('веса 2/1/1 от 100,00: половина и две четверти', () => {
      const result = splitAmounts(10000, {
        mode: 'shares',
        shares: [
          { participantId: 'p1', weight: 2 },
          { participantId: 'p2', weight: 1 },
          { participantId: 'p3', weight: 1 },
        ],
      })
      expect(values(result)).toEqual([5000, 2500, 2500])
    })

    it('равные веса дают то же разбиение, что equal', () => {
      const equal = splitAmounts(10000, { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] })
      const shares = splitAmounts(10000, {
        mode: 'shares',
        shares: [
          { participantId: 'p1', weight: 1 },
          { participantId: 'p2', weight: 1 },
          { participantId: 'p3', weight: 1 },
        ],
      })
      expect(shares).toEqual(equal)
    })

    it('нецелые копейки: наибольшая дробная часть забирает остаток, Σ равна сумме', () => {
      // 0,05 с весами 1/1/2: квоты 1,25 / 1,25 / 2,5 → 1 / 1 / 3
      const result = splitAmounts(5, {
        mode: 'shares',
        shares: [
          { participantId: 'p1', weight: 1 },
          { participantId: 'p2', weight: 1 },
          { participantId: 'p3', weight: 2 },
        ],
      })
      expect(values(result)).toEqual([1, 1, 3])
      expect(result.reduce((sum, share) => sum + share.amount, 0)).toBe(5)
    })

    it('равные дробные части: копейка первому по порядку весов', () => {
      // 0,03 с весами 2/2: квоты по 1,5
      const result = splitAmounts(3, {
        mode: 'shares',
        shares: [
          { participantId: 'p1', weight: 2 },
          { participantId: 'p2', weight: 2 },
        ],
      })
      expect(values(result)).toEqual([2, 1])
    })
  })

  describe('exact — как введено', () => {
    it('порядок и суммы передаются без пересчёта, нулевые доли остаются', () => {
      const result = splitAmounts(10000, {
        mode: 'exact',
        shares: [
          { participantId: 'p2', amount: 3000 },
          { participantId: 'p1', amount: 0 },
          { participantId: 'p3', amount: 7000 },
        ],
      })
      expect(result).toEqual([
        { participantId: 'p2', amount: 3000 },
        { participantId: 'p1', amount: 0 },
        { participantId: 'p3', amount: 7000 },
      ])
    })

    it('Σ долей может не равняться сумме расхода — значения не пересчитываются', () => {
      const result = splitAmounts(1000, {
        mode: 'exact',
        shares: [
          { participantId: 'p1', amount: 400 },
          { participantId: 'p2', amount: 400 },
        ],
      })
      expect(values(result)).toEqual([400, 400])
    })
  })

  describe('инвариант суммы', () => {
    it('equal: Σ долей ровно сумма на неудобных суммах при 3–5 участниках', () => {
      for (const amount of [1, 7, 999, 10001]) {
        for (let k = 3; k <= 5; k++) {
          const shares = splitAmounts(amount, { mode: 'equal', participantIds: ids(k) })
          expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(amount)
        }
      }
    })

    it('shares: Σ долей ровно сумма на тех же суммах при 3–5 весах', () => {
      for (const amount of [1, 7, 999, 10001]) {
        for (let k = 3; k <= 5; k++) {
          const shares = splitAmounts(amount, {
            mode: 'shares',
            shares: ids(k).map((participantId, i) => ({ participantId, weight: i + 1 })),
          })
          expect(shares.reduce((sum, share) => sum + share.amount, 0)).toBe(amount)
        }
      }
    })
  })

  describe('конвертация в базовую валюту (convertToBase)', () => {
    it('курс 1/1 — тождество', () => {
      for (const amount of [1, 50, 999, 123456789]) {
        expect(convertToBase(amount, { num: 1, den: 1 })).toBe(amount)
      }
    })

    it('половина округляется вверх, меньше половины — вниз', () => {
      expect(convertToBase(1, { num: 1, den: 2 })).toBe(1)
      expect(convertToBase(1, { num: 1, den: 3 })).toBe(0)
    })

    it('дробные курсы 0,93 и 7/3', () => {
      // 1,50 × 0,93 = 1,395 → 140
      expect(convertToBase(150, { num: 93, den: 100 })).toBe(140)
      // 0,10 × 7/3 = 0,2333… → 23
      expect(convertToBase(10, { num: 7, den: 3 })).toBe(23)
    })

    it('результат — всегда целое число минорных единиц', () => {
      const rates = [
        { num: 1, den: 1 },
        { num: 1, den: 2 },
        { num: 93, den: 100 },
        { num: 7, den: 3 },
      ]
      for (const rate of rates) {
        for (const amount of [1, 7, 101, 9999]) {
          expect(Number.isInteger(convertToBase(amount, rate))).toBe(true)
        }
      }
    })
  })

  describe('согласованность с балансами', () => {
    it('equal/shares: плательщик вне сплита кредитуется на сумму, доли участников = −splitAmounts', () => {
      const cases: { amount: number; split: Split }[] = [
        { amount: 10000, split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] } },
        { amount: 10001, split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] } },
        {
          amount: 999,
          split: {
            mode: 'shares',
            shares: [
              { participantId: 'p1', weight: 2 },
              { participantId: 'p2', weight: 1 },
              { participantId: 'p3', weight: 1 },
            ],
          },
        },
      ]
      for (const { amount, split } of cases) {
        const balances = byId(computeBalances(buildState(amount, split)))
        expect(balances.get('p0')).toBe(amount)
        for (const share of splitAmounts(amount, split)) {
          expect(balances.get(share.participantId)).toBe(-share.amount)
        }
      }
    })

    it('exact: доли уходят в балансы как введено, плательщик — на их сумму', () => {
      const amount = 1000
      const split: Split = {
        mode: 'exact',
        shares: [
          { participantId: 'p1', amount: 400 },
          { participantId: 'p2', amount: 400 },
        ],
      }
      const balances = byId(computeBalances(buildState(amount, split)))
      const shares = splitAmounts(amount, split)
      expect(balances.get('p0')).toBe(800)
      for (const share of shares) {
        expect(balances.get(share.participantId)).toBe(-share.amount)
      }
    })
  })
})
