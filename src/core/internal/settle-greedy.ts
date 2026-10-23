// Приватный шов ядра: жадный обход седения — максимальный должник гасится
// максимальным кредитором. Первый слой гибрида (ADR 0006) и замыкающий шаг
// точного слоя (settle-exact.ts): одна прогулка — одни тай-брейки.
//
// Работает в индексах массива ненулевых сумм: сортировка очередей — по
// убыванию остатка (модуля баланса), при равенстве — по индексу, он же порядок
// в списке балансов. На компании с нулевой суммой даёт не более k−1 переводов
// на k участников: каждый перевод обнуляет хотя бы одну сторону пары очередей.
// Предусловие: суммы — ненулевые безопасные целые, Σ = 0; арифметика — только
// сложение/вычитание, промежуточные остатки не выходят за модули входа.

/** Перевод во внутренних координатах solver-ов: индексы в массиве ненулевых сумм. */
export interface IndexedTransfer {
  from: number
  to: number
  amount: number
}

/** Остаток очереди: долг должника или требование кредитора. */
interface Row {
  index: number
  rest: number
}

/** Жадный обход: переводы по порядку «максимальный должник → максимальный кредитор». */
export function greedyTransfers(amounts: readonly number[]): IndexedTransfer[] {
  const debtors: Row[] = []
  const creditors: Row[] = []
  amounts.forEach((amount, index) => {
    if (amount < 0) debtors.push({ index, rest: -amount })
    else if (amount > 0) creditors.push({ index, rest: amount })
  })
  const byRestDesc = (a: Row, b: Row) => b.rest - a.rest || a.index - b.index
  debtors.sort(byRestDesc)
  creditors.sort(byRestDesc)

  const transfers: IndexedTransfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = Math.min(debtor.rest, creditor.rest)
    transfers.push({ from: debtor.index, to: creditor.index, amount })
    debtor.rest -= amount
    creditor.rest -= amount
    if (debtor.rest === 0) i += 1
    if (creditor.rest === 0) j += 1
  }
  // Σ ненулевых ровно ноль — очереди исчерпываются одновременно.
  return transfers
}
