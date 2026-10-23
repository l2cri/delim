// Приватный шов ядра: точный solver седения — минимальное число переводов
// поиском по битовым маскам (ADR 0006, тикет 07). Минимум на нулевой по сумме
// компании из n ненулевых участников равен n − g, где g — максимальное число
// групп разбиения на подмножества с нулевой суммой. Нижняя грань: переводы
// связывают участников в компоненты связности с нулевой суммой (перевод не
// выводит деньги за пределы своих концов), k участников компоненты требуют
// не меньше k−1 переводов, а компонент не больше g. Достигается: внутри группы
// размера k — k−1 переводов жадным обходом из settle-greedy.ts.
//
// Поиск: суммы всех 2^n подмножеств, затем ДП по маскам — для каждой нулевой
// маски перебираются её подмаски-группы, содержащие младший бит (в любом
// разбиении ровно одна группа его содержит), остальные раскладываются
// рекурсивно. 2^12 = 4096 масок, перебор подмасок суммарно ≤ 3^n — порог
// EXACT_LIMIT = 12 из ADR 0006.
//
// Детерминированность: разбиение снимается группой с первым по списку
// участником (младший бит маски); при равном числе групп — меньшая группа,
// при равенстве — меньшее значение маски (предпочтение участникам раньше
// по списку); порядок переводов — группы по возрастанию первого участника,
// внутри группы — жадный обход.
//
// Подмножественные суммы копятся на bigint: входы — безопасные целые, но сумма
// подмножества может превысить Number.MAX_SAFE_INTEGER (то же накопление, что
// в гроссбухе balances.ts). Предусловие: суммы ненулевые, Σ = 0, длина ≤
// EXACT_LIMIT; нарушенная Σ оставляет undefined — вызывающий остаётся на
// жадном слое.

import { greedyTransfers, type IndexedTransfer } from './settle-greedy'

/** Порог точного поиска: 2^12 масок — компромисс скорости и пользы (ADR 0006). */
export const EXACT_LIMIT = 12

/**
 * Минимальный список переводов поиском по маскам; undefined — компания не
 * сводится к нулю (нарушенное предусловие). Внутренний шов: вызывается только
 * операцией settle при числе ненулевых ≤ EXACT_LIMIT.
 */
export function exactTransfers(amounts: readonly number[]): IndexedTransfer[] | undefined {
  const n = amounts.length
  if (n === 0) return []
  if (n > EXACT_LIMIT) throw new Error(`точный solver: ${n} ненулевых выше порога ${EXACT_LIMIT}`)

  const big = amounts.map((amount) => BigInt(amount))
  const size = 1 << n
  const isZero = new Uint8Array(size) // 1 — подмножество с нулевой суммой
  const sums = new Array<bigint>(size)
  sums[0] = 0n
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask
    sums[mask] = sums[mask ^ low] + big[bitIndex(low)]
    if (sums[mask] === 0n) isZero[mask] = 1
  }

  const full = size - 1
  const best = new Int8Array(size).fill(-1) // макс. число групп; −1 — маска не нулевой суммы
  const chosen = new Int16Array(size) // группа-подмаска, снимаемая с маски при разборе
  for (let mask = 1; mask < size; mask++) {
    if (isZero[mask] === 0) continue
    best[mask] = 1 // вся маска одной группой
    chosen[mask] = mask
    const low = mask & -mask
    for (let sub = (mask - 1) & mask; sub !== 0; sub = (sub - 1) & mask) {
      if ((sub & low) === 0 || isZero[sub] === 0) continue
      // Дополнение mask ^ sub нулевое и меньше mask — лучший разбор уже посчитан.
      const candidate = best[mask ^ sub] + 1
      if (candidate > best[mask] || (candidate === best[mask] && prefersSmallerGroup(sub, chosen[mask]))) {
        best[mask] = candidate
        chosen[mask] = sub
      }
    }
  }
  if (best[full] < 0) return undefined

  const transfers: IndexedTransfer[] = []
  let rest = full
  while (rest !== 0) {
    const group = chosen[rest]
    const indices: number[] = []
    for (let bits = group; bits !== 0; ) {
      const low = bits & -bits
      indices.push(bitIndex(low))
      bits ^= low
    }
    const groupAmounts = indices.map((index) => amounts[index])
    for (const transfer of greedyTransfers(groupAmounts)) {
      transfers.push({ from: indices[transfer.from], to: indices[transfer.to], amount: transfer.amount })
    }
    rest ^= group
  }
  return transfers
}

/** Индекс участника по маске из одного бита. */
function bitIndex(bit: number): number {
  return 31 - Math.clz32(bit)
}

/** Тай-брейк разбиения: меньше участников в группе, при равенстве — меньше маска. */
function prefersSmallerGroup(a: number, b: number): boolean {
  const sizeA = popcount(a)
  const sizeB = popcount(b)
  return sizeA !== sizeB ? sizeA < sizeB : a < b
}

function popcount(mask: number): number {
  let count = 0
  while (mask !== 0) {
    mask &= mask - 1
    count += 1
  }
  return count
}
