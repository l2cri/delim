// Сведение — операция ядра «settle»: балансы → список переводов «кто→кому
// сколько», погашающий все балансы. Первый слой гибрида из ADR 0006: жадный
// алгоритм — максимальный должник гасится максимальным кредитором; точный
// bitset-поиск для ≤ 12 участников подключается внутри этой же операции
// (тикет 07), наружу выбор solver-а не течёт. Переводы — производная величина,
// а не хранимое состояние (ADR 0010): сечение пересчитывается на каждом вызове.
//
// Контракт:
// - не более n−1 переводов, где n — участники с ненулевым балансом: каждый
//   перевод обнуляет хотя бы одну сторону пары «должник/кредитор»;
// - суммы точные, целые минорные единицы базовой валюты; применение переводов
//   к балансам даёт ноль у каждого;
// - каждый перевод строго положителен; нулевые балансы не участвуют;
// - детерминированность: тай-брейк сортировок — по убыванию модуля баланса,
//   при равенстве — порядок в списке балансов (он же порядок участников).
//
// Предусловие (доверенный вход — выход computeBalances): суммы — безопасные
// целые, Σ балансов ровно ноль. Повторной валидации нет, как и в остальном
// ядре. Арифметика — number: только сложение/вычитание безопасных целых,
// промежуточные значения не выходят за модули входа, точность не теряется.
// Операция чистая: вход не мутируется.

import type { BalanceEntry } from './balances'

/** Перевод седения: участник fromId переводит участнику toId сумму amount. */
export interface Transfer {
  fromId: string
  toId: string
  /** Целые минорные единицы базовой валюты, строго больше нуля. */
  amount: number
}

/** Рабочая запись жадного обхода: остаток долга (у должника) или кредита (у кредитора). */
interface Working {
  participantId: string
  rest: number
  order: number
}

/**
 * Сведение балансов: список переводов, погашающих все балансы в ноль.
 * Порядок переводов — порядок жадного обхода; контракт — в шапке модуля.
 */
export function settle(balances: BalanceEntry[]): Transfer[] {
  const debtors: Working[] = []
  const creditors: Working[] = []
  balances.forEach((entry, order) => {
    if (entry.amount < 0) debtors.push({ participantId: entry.participantId, rest: -entry.amount, order })
    else if (entry.amount > 0) creditors.push({ participantId: entry.participantId, rest: entry.amount, order })
  })
  const byAmountDesc = (a: Working, b: Working) =>
    b.rest - a.rest !== 0 ? b.rest - a.rest : a.order - b.order
  debtors.sort(byAmountDesc)
  creditors.sort(byAmountDesc)

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.rest, creditor.rest)
    transfers.push({ fromId: debtor.participantId, toId: creditor.participantId, amount })
    debtor.rest -= amount
    creditor.rest -= amount
    if (debtor.rest === 0) i += 1
    if (creditor.rest === 0) j += 1
  }
  // Σ балансов ноль — обе очереди исчерпываются одновременно.
  return transfers
}
