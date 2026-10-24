import { describe, expect, it } from 'vitest'
import { computeBalances, type BalanceEntry } from './balances'
import { createNewTrip, type TripState } from './schema'
import { settle, type Transfer } from './settle'

function bal(participantId: string, amount: number): BalanceEntry {
  return { participantId, amount }
}

/**
 * Применить переводы к балансам: перевод гасит баланс — долг должника и требование
 * кредитора идут к нулю (должнику +сумма, кредитору −сумма). Сведение обязано
 * погасить каждый баланс ровно в ноль, а каждый перевод — быть строго положительным.
 */
function expectSettled(balances: BalanceEntry[], transfers: Transfer[]): void {
  const rest = new Map(balances.map((entry) => [entry.participantId, entry.amount]))
  for (const transfer of transfers) {
    expect(transfer.amount, `перевод ${transfer.fromId}→${transfer.toId}`).toBeGreaterThan(0)
    rest.set(transfer.fromId, rest.get(transfer.fromId)! + transfer.amount)
    rest.set(transfer.toId, rest.get(transfer.toId)! - transfer.amount)
  }
  for (const [participantId, amount] of rest) {
    expect(amount, `остаток ${participantId}`).toBe(0)
  }
}

/** Переводы как отображение «отправитель → перевод» — без зависимости от порядка списка. */
function byFrom(transfers: Transfer[]): Map<string, Transfer> {
  return new Map(transfers.map((transfer) => [transfer.fromId, transfer]))
}

/** Булев аналог expectSettled для массовых прогонов: все гасится в ноль, суммы > 0. */
function settlesExactly(balances: BalanceEntry[], transfers: Transfer[]): boolean {
  const rest = new Map(balances.map((entry) => [entry.participantId, entry.amount]))
  for (const transfer of transfers) {
    if (transfer.amount <= 0) return false
    rest.set(transfer.fromId, rest.get(transfer.fromId)! + transfer.amount)
    rest.set(transfer.toId, rest.get(transfer.toId)! - transfer.amount)
  }
  for (const amount of rest.values()) if (amount !== 0) return false
  return true
}

/**
 * Оракул жадного слоя: та же прогулка «максимальный должник → максимальный
 * кредитор» из шапки settle.ts, написанная здесь независимо — поведенческая
 * сверка гибрида без обращения к приватному шву ./internal.
 */
function greedyReference(balances: BalanceEntry[]): Transfer[] {
  type Row = { id: string; rest: number; place: number }
  const rows = (sign: number): Row[] =>
    balances
      .map((entry, place) => ({ entry, place }))
      .filter(({ entry }) => Math.sign(entry.amount) === sign)
      .map(({ entry, place }) => ({ id: entry.participantId, rest: Math.abs(entry.amount), place }))
  const debtors = rows(-1).sort((a, b) => b.rest - a.rest || a.place - b.place)
  const creditors = rows(1).sort((a, b) => b.rest - a.rest || a.place - b.place)
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

/**
 * Эталон минимального числа переводов полным перебором разбиений: максимум
 * нулевых по сумме групп даёт минимум переводов n − g (нижняя грань — переводы
 * связывают участников в нулевые компоненты связности, k участников требуют
 * не меньше k−1 переводов; достигается группой размера k за k−1). Каждый
 * участник либо входит в открытую группу, либо открывает новую; равные частичные
 * суммы групп взаимозаменяемы — ветвление по ним дублируется. Белловское число
 * B(6) = 203 — перебор мгновенный.
 */
function referenceMinTransfers(amounts: number[]): number {
  const nonzero = amounts.filter((amount) => amount !== 0)
  const groupSums: number[] = []
  let best = Number.POSITIVE_INFINITY
  const rec = (i: number): void => {
    if (i === nonzero.length) {
      if (groupSums.every((sum) => sum === 0)) {
        best = Math.min(best, nonzero.length - groupSums.length)
      }
      return
    }
    const seen = new Set<number>()
    for (let g = 0; g < groupSums.length; g++) {
      if (seen.has(groupSums[g])) continue
      seen.add(groupSums[g])
      groupSums[g] += nonzero[i]
      rec(i + 1)
      groupSums[g] -= nonzero[i]
    }
    groupSums.push(nonzero[i])
    rec(i + 1)
    groupSums.pop()
  }
  rec(0)
  return best
}

/** Все профили длины length со значениями −3..3 (включая нули) и Σ = 0. */
function* zeroSumProfiles(length: number): Generator<number[]> {
  const values = [-3, -2, -1, 0, 1, 2, 3]
  const profile: number[] = []
  function* rec(i: number, sum: number): Generator<number[]> {
    const reachable = 3 * (length - i) // максимум |остатка суммы| из оставшихся
    if (Math.abs(sum) > reachable) return
    if (i === length) {
      if (sum === 0) yield [...profile]
      return
    }
    for (const value of values) {
      profile.push(value)
      yield* rec(i + 1, sum + value)
      profile.pop()
    }
  }
  yield* rec(0, 0)
}

describe('операция «сведение» (гибрид жадного и точного)', () => {
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
      // Ненулевой баланс у единственного участника невозможен: предусловие Σ = 0.
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
      // Край из тикета: группы с точными парами «долг = кредит» — экстремумы
      // очередей жадного совпадают внутри групп, переводов между группами нет.
      // На кривых нулевых подмножествах жадный мог бы пересечь группы лишним
      // переводом — при ≤ 12 ненулевых это подхватывает точный слой гибрида
      // (контрпример ниже); здесь оба слоя дают одинаковый минимум.
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

      // Две несвязные группы: минимум переводов (2−1)+(3−1) = 3 — и жадный его даёт.
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
      // У профиля нет собственного нулевого подмножества — минимум переводов
      // ровно n−1 = 3; точный solver из тикета 07 короче не станет.
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

  describe('гибрид: точный слой (≤ 12 ненулевых)', () => {
    it('контрпример жадного — два нулевых подмножества — сводится короче', () => {
      // [+4, −2, −2, +3, −3]: нулевые подмножества {+4,−2,−2} и {+3,−3} —
      // минимум 5 − 2 = 3 перевода. Чистый жадный из-за сортировки по модулю
      // гасит −3 остатками +4 и рвёт пару {+3,−3} — 4 перевода.
      const balances = [bal('p1', 4), bal('p2', -2), bal('p3', -2), bal('p4', 3), bal('p5', -3)]
      expect(greedyReference(balances)).toHaveLength(4)

      const transfers = settle(balances)
      expect(transfers).toHaveLength(3)
      // Тай-брейки точного слоя из шапки settle.ts: группы по первому участнику,
      // внутри — жадный обход (должники −2/−2 по порядку списка).
      expect(transfers).toEqual([
        { fromId: 'p2', toId: 'p1', amount: 2 },
        { fromId: 'p3', toId: 'p1', amount: 2 },
        { fromId: 'p5', toId: 'p4', amount: 3 },
      ])
      expectSettled(balances, transfers)
    })

    it('ровно на границе 12 ненулевых точный слой всё ещё выигрывает', () => {
      // Контрпример (5 участников) + тройка {+5,+6,−11} + пары {+1,−1}, {+2,−2}
      // = 12 ненулевых; 5 нулевых групп → минимум 12 − 5 = 7.
      const balances = [
        bal('p1', 4),
        bal('p2', -2),
        bal('p3', -2),
        bal('p4', 3),
        bal('p5', -3),
        bal('p6', 5),
        bal('p7', 6),
        bal('p8', -11),
        bal('p9', 1),
        bal('p10', -1),
        bal('p11', 2),
        bal('p12', -2),
      ]
      expect(greedyReference(balances)).toHaveLength(8)
      const transfers = settle(balances)
      expect(transfers).toHaveLength(7)
      expectSettled(balances, transfers)
    })

    it('тяжёлый профиль из 12 ненулевых — точный поиск укладывается в разумное время', () => {
      // Шесть +1 и шесть −1: 923 нулевых по сумме подмаски из 4096 — максимум
      // ветвления ДП; минимум 6 переводов (6 групп-пар, жадный даёт столько же).
      const balances = Array.from({ length: 6 }, (_, i) => bal(`c${i}`, 1)).concat(
        Array.from({ length: 6 }, (_, i) => bal(`d${i}`, -1)),
      )

      const started = performance.now()
      const transfers = settle(balances)
      const elapsed = performance.now() - started

      expect(transfers).toHaveLength(6)
      expectSettled(balances, transfers)
      // Запас ×100 к фактическому времени (единицы мс): ловит экспоненциальный
      // занос, не флакая на медленной машине.
      expect(elapsed).toBeLessThan(1000)
    })

    it('при 13 ненулевых точный поиск не запускается — поведение чисто жадное', () => {
      // Контрпример (5) + четыре нулевые пары (8) = 13: точный дал бы 13 − 6 = 7,
      // но порог ADR 0006 уже пройден. Сверяемся с независимым оракулом жадного
      // слоя — сам шов наружу не течёт, у settle одинаковый ответ на любом входе.
      const balances = [
        bal('p1', 4),
        bal('p2', -2),
        bal('p3', -2),
        bal('p4', 3),
        bal('p5', -3),
        bal('p6', 1),
        bal('p7', -1),
        bal('p8', 2),
        bal('p9', -2),
        bal('p10', 3),
        bal('p11', -3),
        bal('p12', 4),
        bal('p13', -4),
      ]
      const greedy = greedyReference(balances)
      expect(greedy).toHaveLength(9)
      expect(greedy.length).toBeGreaterThan(7) // 7 — точный, если бы запустился: профиль различает слои
      expect(settle(balances)).toEqual(greedy)
    })

    it('точный путь детерминирован', () => {
      const balances = [bal('p1', 4), bal('p2', -2), bal('p3', -2), bal('p4', 3), bal('p5', -3)]
      expect(settle(balances)).toEqual(settle(balances))
    })

    it('точный путь не мутирует вход', () => {
      const balances = [bal('p1', 4), bal('p2', -2), bal('p3', -2), bal('p4', 3), bal('p5', -3)]
      const snapshot = balances.map((entry) => ({ ...entry }))
      settle(balances)
      expect(balances).toEqual(snapshot)
    })
  })

  describe('exhaustive-сверка с эталонным перебором (n ≤ 6)', () => {
    it('сведение не хуже эталона на всех профилях из ±1..3 при Σ = 0', () => {
      // При ≤ 6 ненулевых точный слой обязан дать ровно эталонный минимум
      // (сведение не может быть и лучше него — нижняя грань теоремы), а заодно
      // гасить балансы в ноль строго положительными переводами.
      const failures: string[] = []
      let checked = 0
      for (let n = 2; n <= 6; n++) {
        for (const amounts of zeroSumProfiles(n)) {
          checked += 1
          const balances = amounts.map((amount, i) => bal(`p${i}`, amount))
          const transfers = settle(balances)
          const reference = referenceMinTransfers(amounts)
          if (transfers.length !== reference || !settlesExactly(balances, transfers)) {
            failures.push(
              `профиль [${amounts.join(', ')}]: эталон ${reference}, ` +
                `факт ${transfers.length} — ${JSON.stringify(transfers)}`,
            )
          }
        }
      }
      expect(checked).toBeGreaterThan(5000) // пространство живо, а не выродилось
      expect(failures.slice(0, 5), `проверено профилей: ${checked}`).toEqual([])
    })

    it('жадный оракул гасит в ноль и не короче эталона (санити-связка оракулов)', () => {
      // Хвост ревью тикета 07 (SPEC п.3 — «против обоих алгоритмов»): на том же
      // полном переборе прогоняется и жадный слой. Эталон — теоретический
      // минимум, поэтому жадный не может быть короче него; а как валидное
      // сведение — обязан гасить все балансы и укладываться в ненулевых − 1.
      // Связка оракулов замыкает треугольник: settle == эталон (тест выше)
      // и жадный ≥ эталон ⟹ сведение не хуже жадного на всём пространстве.
      const failures: string[] = []
      let checked = 0
      for (let n = 2; n <= 6; n++) {
        for (const amounts of zeroSumProfiles(n)) {
          checked += 1
          const balances = amounts.map((amount, i) => bal(`p${i}`, amount))
          const greedy = greedyReference(balances)
          const reference = referenceMinTransfers(amounts)
          const nonzero = amounts.filter((amount) => amount !== 0).length
          const ok =
            settlesExactly(balances, greedy) &&
            greedy.length >= reference &&
            greedy.length <= Math.max(0, nonzero - 1)
          if (!ok) {
            failures.push(
              `профиль [${amounts.join(', ')}]: жадный ${greedy.length} — ${JSON.stringify(greedy)}, ` +
                `эталон ${reference}, ненулевых ${nonzero}`,
            )
          }
        }
      }
      expect(checked).toBeGreaterThan(5000)
      expect(failures.slice(0, 5), `проверено профилей: ${checked}`).toEqual([])
    })
  })
})
