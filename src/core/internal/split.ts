// Приватный шов ядра: расщепление суммы по сплиту — общая пропорциональная часть
// гроссбуха (balances.ts) и операции разбиения для UI (splits.ts). Одно и то же
// вычисление: рациональные квоты по режиму сплита × курс, конвертированная сумма —
// округление Σ квот к минорной единице (половина вверх), целые доли — методом
// наибольших остатков (ADR 0004) до Σ ровно конвертированная сумма, при равных
// дробных частях — раньше по порядку внутри сплита. При курсе 1/1 это в точности
// разбиение суммы расхода в её собственной валюте.

import type { Rational, Split } from '../schema'
import { addRat, largestRemainder, rat, roundHalfUpRat, type Rat } from './rat'

/** Курс тождества 1/1: сумма уже в базовой валюте. */
export const UNIT_RATE: Rational = { num: 1, den: 1 }

/** Точные рациональные квоты участников сплита: amount в валюте расхода, rate — в базовую. */
export function splitQuotas(split: Split, amount: number, rate: Rational): Rat[] {
  const value = BigInt(amount)
  const num = BigInt(rate.num)
  const den = BigInt(rate.den)
  switch (split.mode) {
    case 'equal': {
      const k = BigInt(split.participantIds.length)
      return split.participantIds.map(() => rat(value * num, den * k))
    }
    case 'shares': {
      const w = split.shares.reduce((sum, share) => sum + BigInt(share.weight), 0n)
      return split.shares.map((share) => rat(value * BigInt(share.weight) * num, den * w))
    }
    case 'exact': {
      // Квоты — из введённых сумм; сумма расхода не участвует (покрытая часть).
      return split.shares.map((share) => rat(BigInt(share.amount) * num, den))
    }
  }
}

/**
 * Конвертированный расход и его целые доли: total = roundHalfUp(Σ квот),
 * доли — наибольшими остатками, Σ долей ровно total.
 */
export function splitConverted(
  split: Split,
  amount: number,
  rate: Rational,
): { total: bigint; shares: bigint[] } {
  const quotas = splitQuotas(split, amount, rate)
  const total = roundHalfUpRat(quotas.reduce(addRat))
  return { total, shares: largestRemainder(quotas, total) }
}

/** Конвертация одиночной суммы в базовую валюту: roundHalfUp(amount × num / den). */
export function convertAmount(amount: number, rate: Rational): bigint {
  return roundHalfUpRat(rat(BigInt(amount) * BigInt(rate.num), BigInt(rate.den)))
}

/** Участники сплита в порядке следования — общий порядок квот и долей. */
export function splitParticipantIds(split: Split): string[] {
  switch (split.mode) {
    case 'equal':
      return split.participantIds
    case 'exact':
      return split.shares.map((share) => share.participantId)
    case 'shares':
      return split.shares.map((share) => share.participantId)
  }
}
