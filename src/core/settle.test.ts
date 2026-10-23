import { describe, expect, it } from 'vitest'
import { computeBalances, type BalanceEntry } from './balances'
import { createNewTrip, type TripState } from './schema'
import { settle, type Transfer } from './settle'

function bal(participantId: string, amount: number): BalanceEntry {
  return { participantId, amount }
}

/**
 * Применить переводы к балансам: сведение обязано погасить каждый баланс ровно
 * в ноль, а каждый перевод — быть строго положительным.
 */
function expectSettled(balances: BalanceEntry[], transfers: Transfer[]): void {
  const rest = new Map(balances.map((entry) => [entry.participantId, entry.amount]))
  for (const transfer of transfers) {
    expect(transfer.amount, `перевод ${transfer.fromId}→${transfer.toId}`).toBeGreaterThan(0)
    rest.set(transfer.fromId, rest.get(transfer.fromId)! - transfer.amount)
    rest.set(transfer.toId, rest.get(transfer.toId)! + transfer.amount)
  }
  for (const [participantId, amount] of rest) {
    expect(amount, `остаток ${participantId}`).toBe(0)
  }
}

/** Переводы как отображение «отправитель → перевод» — без зависимости от порядка списка. */
function byFrom(transfers: Transfer[]): Map<string, Transfer> {
  return new Map(transfers.map((transfer) => [transfer.fromId, transfer]))
}

describe('операция «сведение» (жадный слой)', () => {
  describe('классический пример из питча', () => {
    it('«А переводит Б 1500 ₽, В переводит Б 800 ₽» — ровно два перевода кредитору', () => {
      // Питч SPEC говорит в рублях, ядро — в минорных единицах: 2300 ₽ = 230 000 коп.
      const state: TripState = createNewTrip({ name: 'Выходные', baseCurrency: 'RUB' })
      state.participants.push(
        { id: 'p1', name: 'Аня', color: '#10b981', emoji: '🦊' },
        { id: 'p2', name: 'Боря', color: '#f59e0b', emoji: '🐢' },
        { id: 'p3', name: 'Вика', color: '#3b82f6', emoji: '🦉' },
      )
      state.expenses.push({
        id: 'e1',
        title: 'Домик на двоих суток',
        payerId: 'p2',
        amount: 230000,
        currencyCode: 'RUB',
        createdAt: '2026-10-01T10:00:00.000Z',
        split: {
          mode: 'exact',
          shares: [
            { participantId: 'p1', amount: 150000 },
            { participantId: 'p3', amount: 80000 },
          ],
        },
      })
      const balances = computeBalances(state)
      const transfers = settle(balances)

      expect(transfers).toHaveLength(2)
      const fromAnna = byFrom(transfers).get('p1')!
      const fromVika = byFrom(transfers).get('p3')!
      expect(fromAnna).toEqual({ fromId: 'p1', toId: 'p2', amount: 150000 })
      expect(fromVika).toEqual({ fromId: 'p3', toId: 'p2', amount: 80000 })
      expectSettled(balances, transfers)
    })
  })

  describe('края', () => {
    it('ноль участников — пустой результат', () => {
      expect(settle([])).toEqual([])
    })

    it('один участник с нулевым балансом — пустой результат', () => {
      expect(settle([bal('solo', 0)])).toEqual([])
    })

    it('все в нуле — пустой результат', () => {
      const balances = [bal('p1', 0), bal('p2', 0), bal('p3', 0), bal('p4', 0)]
      expect(settle(balances)).toEqual([])
    })

    it('двое: единственный должник гасится единственным кредитором одним переводом', () => {
      const balances = [bal('p1', 7000), bal('p2', -7000)]
      const transfers = settle(balances)
      expect(transfers).toEqual([{ fromId: 'p2', toId: 'p1', amount: 7000 }])
      expectSettled(balances, transfers)
    })

    it('несвязные группы гасятся внутри себя, без переводов между группами', () => {
      const groupOne = new Set(['x', 'y'])
      const groupTwo = new Set(['p', 'q', 'r'])
      const balances = [
        bal('x', 100),
        bal('y', -100),
        bal('p', 40),
        bal('q', -15),
        bal('r', -25),
      ]
      const transfers = settle(balances)

      expect(transfers).toHaveLength(3)
      for (const transfer of transfers) {
        const sameGroup =
          (groupOne.has(transfer.fromId) && groupOne.has(transfer.toId)) ||
          (groupTwo.has(transfer.fromId) && groupTwo.has(transfer.toId))
        expect(sameGroup, `${transfer.fromId}→${transfer.toId}`).toBe(true)
      }
      expectSettled(balances, transfers)
    })
  })

  describe('копеечные остатки и точность', () => {
    it('копейка идёт отдельным переводом — ни один перевод не нулевой и не отрицательный', () => {
      const balances = [bal('p1', 5000), bal('p2', 1), bal('p3', -4000), bal('p4', -1001)]
      const transfers = settle(balances)
      expect(transfers).toHaveLength(3)
      for (const transfer of transfers) {
        expect(transfer.amount).toBeGreaterThan(0)
        expect(Number.isInteger(transfer.amount)).toBe(true)
      }
      expectSettled(balances, transfers)
    })

    it('единичные остатки с двух сторон гасятся точно', () => {
      const balances = [bal('p1', 10000), bal('p2', -9999), bal('p3', -1)]
      const transfers = settle(balances)
      expectSettled(balances, transfers)
      expect(byFrom(transfers).get('p2')!.amount).toBe(9999)
      expect(byFrom(transfers).get('p3')!.amount).toBe(1)
    })

    it('сумма переводов каждого участника погашает его баланс крупными суммами', () => {
      const balances = [
        bal('p1', 123456789),
        bal('p2', -98765432),
        bal('p3', -24691357),
      ]
      const transfers = settle(balances)
      expectSettled(balances, transfers)
    })
  })

  describe('контракт числа переводов', () => {
    it('несколько должников и кредиторов — не более n−1 переводов', () => {
      const balances = [
        bal('p1', 900),
        bal('p2', 500),
        bal('p3', 300),
        bal('p4', -400),
        bal('p5', -600),
        bal('p6', -700),
      ]
      const transfers = settle(balances)
      expect(transfers.length).toBeLessThanOrEqual(5)
      expectSettled(balances, transfers)
    })

    it('цепочка «должник платит нескольким кредиторам» укладывается в n−1', () => {
      const balances = [bal('p1', -100), bal('p2', 60), bal('p3', 40)]
      const transfers = settle(balances)
      expect(transfers).toHaveLength(2)
      expectSettled(balances, transfers)
    })

    it('равные по модулю балансы тай-брейка не ломают погашение', () => {
      const balances = [bal('p1', 50), bal('p2', 50), bal('p3', -100)]
      const transfers = settle(balances)
      expect(transfers).toHaveLength(2)
      const amounts = transfers.map((transfer) => transfer.amount).sort((a, b) => a - b)
      expect(amounts).toEqual([50, 50])
      expectSettled(balances, transfers)
    })
  })

  describe('чистота и детерминированность', () => {
    it('повторный вызов на том же входе даёт тот же результат', () => {
      const balances = [bal('p1', 300), bal('p2', 100), bal('p3', -150), bal('p4', -250)]
      expect(settle(balances)).toEqual(settle(balances))
    })

    it('вход не мутируется', () => {
      const balances = [bal('p1', 300), bal('p2', 100), bal('p3', -150), bal('p4', -250)]
      const snapshot = balances.map((entry) => ({ ...entry }))
      settle(balances)
      expect(balances).toEqual(snapshot)
    })
  })
})
