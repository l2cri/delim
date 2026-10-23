import { describe, expect, it } from 'vitest'
import {
  createNewTrip,
  parseTripState,
  type Expense,
  type Split,
  type TripState,
} from './schema'
import { computeBalances, type BalanceEntry } from './balances'

const ISO = '2026-10-01T10:00:00.000Z'

/** Четыре участника, базовая RUB, чужие валюты: USD 913/10, GEL 31/2, дробные курсы 1/3 и 2/3. */
function buildState(): TripState {
  const state = createNewTrip({ name: 'Тестовая поездка', baseCurrency: 'RUB' })
  state.participants.push(
    { id: 'p1', name: 'Аня', color: '#10b981', emoji: '🦊' },
    { id: 'p2', name: 'Боря', color: '#f59e0b', emoji: '🐢' },
    { id: 'p3', name: 'Вика', color: '#3b82f6', emoji: '🦉' },
    { id: 'p4', name: 'Гоша', color: '#ef4444', emoji: '🐺' },
  )
  state.currencies.push(
    { code: 'USD', rate: { num: 913, den: 10 } },
    { code: 'GEL', rate: { num: 31, den: 2 } },
    { code: 'AAA', rate: { num: 1, den: 3 } },
    { code: 'BBB', rate: { num: 2, den: 3 } },
  )
  return state
}

let expenseSeq = 0

function makeExpense(input: {
  payerId: string
  amount: number
  currencyCode?: string
  split: Split
}): Expense {
  expenseSeq += 1
  return {
    id: `e${expenseSeq}`,
    title: 'Ужин',
    payerId: input.payerId,
    amount: input.amount,
    currencyCode: input.currencyCode ?? 'RUB',
    createdAt: ISO,
    split: input.split,
  }
}

/** Балансы как отображение «участник → сумма». */
function byId(entries: BalanceEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.participantId, e.amount]))
}

/** Инвариант нуля: деньги не возникают и не исчезают. */
function expectZeroSum(entries: BalanceEntry[]): void {
  expect(entries.reduce((sum, e) => sum + e.amount, 0)).toBe(0)
}

describe('операция «балансы» (гроссбух)', () => {
  describe('расход в базовой валюте поровну', () => {
    it('четверо делят без остатка: у каждого ровно четверть, сумма балансов ноль', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 10000,
          split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3', 'p4'] },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(7500)
      expect(balances.get('p2')).toBe(-2500)
      expect(balances.get('p3')).toBe(-2500)
      expect(balances.get('p4')).toBe(-2500)
      expectZeroSum(computeBalances(state))
    })

    it('нецелое деление: копейка уходит первому по порядку внутри сплита', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 10001,
          split: { mode: 'equal', participantIds: ['p3', 'p2', 'p1', 'p4'] },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p3')).toBe(-2501)
      expect(balances.get('p2')).toBe(-2500)
      expect(balances.get('p1')).toBe(7501)
      expect(balances.get('p4')).toBe(-2500)
      expectZeroSum(computeBalances(state))
    })

    it('плательщик вне сплита: кредитуется весь расход, дебетуется только сплит', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 900,
          split: { mode: 'equal', participantIds: ['p2', 'p3', 'p4'] },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(900)
      expect(balances.get('p2')).toBe(-300)
      expect(balances.get('p3')).toBe(-300)
      expect(balances.get('p4')).toBe(-300)
      expectZeroSum(computeBalances(state))
    })
  })

  describe('чужая валюта и живой курс', () => {
    it('курс-дробь конвертируется точно, остатки деления распределены наибольшими остатками', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p4',
          amount: 100000, // 1000,00 USD
          currencyCode: 'USD',
          split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] },
        }),
      )
      // 100000 × 913/10 = 9 130 000 мин.ед.; квоты 3 043 333⅓ → 3043334 + 3043333 + 3043333
      const balances = byId(computeBalances(state))
      expect(balances.get('p4')).toBe(9130000)
      expect(balances.get('p1')).toBe(-3043334)
      expect(balances.get('p2')).toBe(-3043333)
      expect(balances.get('p3')).toBe(-3043333)
      expectZeroSum(computeBalances(state))
    })

    it('нецелый конвертированный расход округляется к копейке, сумма долей равна ему', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p3',
          amount: 7, // 7 × 1/3 = 2⅓ → конвертированный расход 2
          currencyCode: 'AAA',
          split: { mode: 'equal', participantIds: ['p1', 'p2'] },
        }),
      )
      state.expenses.push(
        makeExpense({
          payerId: 'p4',
          amount: 1, // 1 × 2/3 = ⅔ → округляется вверх до 1; обе квоты 2/9, копейка первой в сплите
          currencyCode: 'BBB',
          split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p3')).toBe(2)
      expect(balances.get('p1')).toBe(-2)
      expect(balances.get('p2')).toBe(-1)
      expect(balances.get('p4')).toBe(1)
      expectZeroSum(computeBalances(state))
    })

    it('правка курса пересчитывает уже введённые расходы задним числом', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 10000, // 100,00 USD
          currencyCode: 'USD',
          split: { mode: 'equal', participantIds: ['p1', 'p2'] },
        }),
      )
      const before = byId(computeBalances(state))
      expect(before.get('p1')).toBe(456500)
      expect(before.get('p2')).toBe(-456500)

      const usd = state.currencies.find((c) => c.code === 'USD')!
      usd.rate = { num: 92, den: 1 }

      const after = byId(computeBalances(state))
      expect(after.get('p1')).toBe(460000)
      expect(after.get('p2')).toBe(-460000)
      expectZeroSum(computeBalances(state))
    })
  })

  describe('точные суммы, доли и выплаты', () => {
    it('точные суммы дают корректные дебеты, включая нецелую конвертацию', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p2',
          amount: 10000,
          split: {
            mode: 'exact',
            shares: [
              { participantId: 'p1', amount: 3000 },
              { participantId: 'p2', amount: 3000 },
              { participantId: 'p3', amount: 4000 },
            ],
          },
        }),
      )
      state.expenses.push(
        makeExpense({
          payerId: 'p4',
          amount: 20101, // 201,01 USD → 1 835 221,3 мин.ед. → 1 835 221
          currencyCode: 'USD',
          split: {
            mode: 'exact',
            shares: [
              { participantId: 'p1', amount: 10000 }, // 100 USD → ровно 913 000
              { participantId: 'p2', amount: 10101 }, // 101,01 USD → 922 221,3 → 922 221
            ],
          },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(-3000 - 913000)
      expect(balances.get('p2')).toBe(10000 - 3000 - 922221)
      expect(balances.get('p3')).toBe(-4000)
      expect(balances.get('p4')).toBe(1835221)
      expectZeroSum(computeBalances(state))
    })

    it('доли делят пропорционально весам, остаток — наибольшим остаткам', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 4000,
          split: {
            mode: 'shares',
            shares: [
              { participantId: 'p1', weight: 2 },
              { participantId: 'p2', weight: 1 },
              { participantId: 'p3', weight: 1 },
            ],
          },
        }),
      )
      state.expenses.push(
        makeExpense({
          payerId: 'p4',
          amount: 1000,
          split: {
            mode: 'shares',
            shares: [
              { participantId: 'p1', weight: 1 },
              { participantId: 'p2', weight: 1 },
              { participantId: 'p3', weight: 1 },
            ],
          },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(4000 - 2000 - 334)
      expect(balances.get('p2')).toBe(-1000 - 333)
      expect(balances.get('p3')).toBe(-1000 - 333)
      expect(balances.get('p4')).toBe(1000)
      expectZeroSum(computeBalances(state))
    })

    it('выплата уменьшает баланс отправителя и увеличивает получателя', () => {
      const state = buildState()
      state.payments.push({
        id: 'v1',
        fromId: 'p2',
        toId: 'p1',
        amount: 50000,
        currencyCode: 'RUB',
      })
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(50000)
      expect(balances.get('p2')).toBe(-50000)
      expect(balances.get('p3')).toBe(0)
      expect(balances.get('p4')).toBe(0)
      expectZeroSum(computeBalances(state))
    })

    it('выплата в чужой валюте конвертируется по живому курсу', () => {
      const state = buildState()
      state.payments.push({
        id: 'v1',
        fromId: 'p1',
        toId: 'p2',
        amount: 10000,
        currencyCode: 'USD',
      })
      expect(byId(computeBalances(state)).get('p1')).toBe(-913000)
      expect(byId(computeBalances(state)).get('p2')).toBe(913000)

      const usd = state.currencies.find((c) => c.code === 'USD')!
      usd.rate = { num: 92, den: 1 }
      expect(byId(computeBalances(state)).get('p1')).toBe(-920000)
      expect(byId(computeBalances(state)).get('p2')).toBe(920000)
      expectZeroSum(computeBalances(state))
    })
  })

  describe('края', () => {
    it('пустая поездка: ни участников, ни движений — пустой список', () => {
      const state = createNewTrip({ name: 'Пустая', baseCurrency: 'RUB' })
      expect(computeBalances(state)).toEqual([])
    })

    it('один участник, расход сам на себя: баланс ноль', () => {
      const state = createNewTrip({ name: 'Одиночка', baseCurrency: 'RUB' })
      state.participants.push({ id: 'p1', name: 'Аня', color: '#10b981', emoji: '🦊' })
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 5000,
          split: { mode: 'equal', participantIds: ['p1'] },
        }),
      )
      expect(computeBalances(state)).toEqual([{ participantId: 'p1', amount: 0 }])
    })

    it('участник без активности получает ноль', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 1000,
          split: { mode: 'equal', participantIds: ['p1', 'p2'] },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p3')).toBe(0)
      expect(balances.get('p4')).toBe(0)
    })

    it('нулевые точные суммы: никому ничего не должно', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 1000,
          split: {
            mode: 'exact',
            shares: [
              { participantId: 'p1', amount: 0 },
              { participantId: 'p2', amount: 0 },
            ],
          },
        }),
      )
      for (const entry of computeBalances(state)) {
        expect(entry.amount).toBe(0)
      }
      expectZeroSum(computeBalances(state))
    })

    it('сплит не покрывает сумму расхода: плательщик кредитуется покрытой частью, инвариант нуля держится', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 1000,
          split: {
            mode: 'exact',
            shares: [
              { participantId: 'p1', amount: 400 },
              { participantId: 'p2', amount: 400 },
            ],
          },
        }),
      )
      const balances = byId(computeBalances(state))
      expect(balances.get('p1')).toBe(400)
      expect(balances.get('p2')).toBe(-400)
      expectZeroSum(computeBalances(state))
    })

    it('расход без участников не проходит схему', () => {
      const state = buildState()
      state.expenses.push(
        makeExpense({
          payerId: 'p1',
          amount: 1000,
          split: { mode: 'equal', participantIds: [] },
        }),
      )
      const result = parseTripState(JSON.stringify(state))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('damaged')
    })
  })
})
