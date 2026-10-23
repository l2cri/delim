// Гроссбух — операция «балансы» интерфейса ядра: валидный стейт поездки → баланс
// каждого участника в целых минорных единицах базовой валюты. «+» — участнику должны,
// «−» — должен он; сумма балансов всегда ровно ноль: деньги не возникают и не исчезают.
//
// Курс валюты — точное рациональное num/den и живое значение из настроек (ADR 0005):
// расход и выплата хранят только сумму и валюту, пересчёт задним числом — при каждом
// вызове. Конвертация: amount × num / den.
//
// Расход: по режиму сплита считаются точные рациональные квоты участников (в минорных
// единицах базовой валюты), конвертированная потреблённая сумма N — округлённые к копейке
// Σ квот (половина вверх), целые доли — методом наибольших остатков (ADR 0004): каждому
// floor(q_i), затем N − Σ floor копеек — участникам с наибольшей дробной частью, при
// равных — раньше по порядку внутри сплита. Сумма долей ровно N; плательщик кредитуется
// на N. Когда exact-сплит не покрывает сумму расхода (UI блокирует сохранение такого,
// но схема допускает), N считается по покрытой части — инвариант нуля держится безусловно
// на любом валидном по схеме стейте.
//
// Выплата: c = roundHalfUp(amount × num / den); отправителю −c, получателю +c.
//
// Вся рациональная арифметика — на bigint (как в calculator.ts), накопление проводок —
// тоже bigint, перевод в number на выходе. Предусловие контракта: итоговые балансы
// помещаются в Number.MAX_SAFE_INTEGER. Вход — валидный TripState (создан
// createNewTrip/parseTripState): операция чистая и детерминированная, повторной
// валидации не выполняет.

import type { Expense, Rational, Split, TripState } from './schema'

/** Баланс участника: целые минорные единицы базовой валюты. */
export interface BalanceEntry {
  participantId: string
  amount: number
}

/** Неотрицательное рациональное n/d, d > 0, несократимая. */
interface Rat {
  n: bigint
  d: bigint
}

function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) {
    const r = a % b
    a = b
    b = r
  }
  return a
}

function rat(n: bigint, d: bigint): Rat {
  const g = gcd(n, d)
  return { n: n / g, d: d / g }
}

function addRat(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d)
}

/** floor для неотрицательного рационального: знаменатель > 0, округление вниз. */
function floorRat(a: Rat): bigint {
  return a.n / a.d
}

/** Сравнение дробных частей без деления — перекрёстным умножением. */
function fracCmp(a: Rat, b: Rat): number {
  const l = (a.n % a.d) * b.d
  const r = (b.n % b.d) * a.d
  return l < r ? -1 : l > r ? 1 : 0
}

/** Округление к ближайшей минорной единице, половина — вверх. */
function roundHalfUpRat(a: Rat): bigint {
  return floorRat(a) + (2n * (a.n % a.d) >= a.d ? 1n : 0n)
}

/** Точные квоты участников сплита в минорных единицах базовой валюты. */
function splitQuotas(expense: Expense, rate: Rational): Rat[] {
  const amount = BigInt(expense.amount)
  const num = BigInt(rate.num)
  const den = BigInt(rate.den)
  switch (expense.split.mode) {
    case 'equal': {
      const k = BigInt(expense.split.participantIds.length)
      return expense.split.participantIds.map(() => rat(amount * num, den * k))
    }
    case 'shares': {
      const w = expense.split.shares.reduce((sum, share) => sum + BigInt(share.weight), 0n)
      return expense.split.shares.map((share) =>
        rat(amount * BigInt(share.weight) * num, den * w),
      )
    }
    case 'exact': {
      return expense.split.shares.map((share) => rat(BigInt(share.amount) * num, den))
    }
  }
}

/** Наибольшие остатки: каждому floor(q_i), остаток total − Σ floor — по наибольшей дробной части. */
function largestRemainder(quotas: Rat[], total: bigint): bigint[] {
  const shares = quotas.map(floorRat)
  let remainder = total - shares.reduce((sum, floor) => sum + floor, 0n)
  const order = quotas.map((_, i) => i).sort((i, j) => {
    const byFrac = fracCmp(quotas[i], quotas[j])
    return byFrac !== 0 ? -byFrac : i - j
  })
  for (const i of order) {
    if (remainder <= 0n) break
    shares[i] += 1n
    remainder -= 1n
  }
  return shares
}

function splitParticipantIds(split: Split): string[] {
  switch (split.mode) {
    case 'equal':
      return split.participantIds
    case 'exact':
      return split.shares.map((share) => share.participantId)
    case 'shares':
      return split.shares.map((share) => share.participantId)
  }
}

/**
 * Балансы поездки: по одной записи на каждого участника state.participants, в том же
 * порядке; участник без расходов и выплат получает ноль.
 */
export function computeBalances(state: TripState): BalanceEntry[] {
  const balances = new Map<string, bigint>()
  for (const participant of state.participants) balances.set(participant.id, 0n)
  const apply = (id: string, delta: bigint) =>
    balances.set(id, (balances.get(id) ?? 0n) + delta)
  // Курсы есть для кодов всех расходов и выплат — предусловие валидного стейта.
  const rates = new Map(state.currencies.map((c) => [c.code, c.rate]))

  for (const expense of state.expenses) {
    const rate = rates.get(expense.currencyCode)!
    const quotas = splitQuotas(expense, rate)
    const consumed = roundHalfUpRat(quotas.reduce(addRat))
    const shares = largestRemainder(quotas, consumed)
    apply(expense.payerId, consumed)
    for (const [i, id] of splitParticipantIds(expense.split).entries()) {
      apply(id, -shares[i])
    }
  }

  for (const payment of state.payments) {
    const rate = rates.get(payment.currencyCode)!
    const converted = roundHalfUpRat(
      rat(BigInt(payment.amount) * BigInt(rate.num), BigInt(rate.den)),
    )
    apply(payment.fromId, -converted)
    apply(payment.toId, converted)
  }

  return state.participants.map((participant) => ({
    participantId: participant.id,
    amount: Number(balances.get(participant.id)),
  }))
}
