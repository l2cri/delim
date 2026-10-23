// Приватный шов ядра: рациональная арифметика на bigint, общая для гроссбуха
// (balances.ts) и разбиения сплитов (splits.ts). Наружу не течёт — только через
// операции интерфейса ядра. Все величины неотрицательные, деноминатор > 0.

/** Неотрицательное рациональное n/d, d > 0, несократимая. */
export interface Rat {
  n: bigint
  d: bigint
}

export function gcd(a: bigint, b: bigint): bigint {
  while (b > 0n) {
    const r = a % b
    a = b
    b = r
  }
  return a
}

export function rat(n: bigint, d: bigint): Rat {
  const g = gcd(n, d)
  return { n: n / g, d: d / g }
}

export function addRat(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d)
}

/** floor для неотрицательного рационального: знаменатель > 0, округление вниз. */
export function floorRat(a: Rat): bigint {
  return a.n / a.d
}

/** Сравнение дробных частей без деления — перекрёстным умножением. */
export function fracCmp(a: Rat, b: Rat): number {
  const l = (a.n % a.d) * b.d
  const r = (b.n % b.d) * a.d
  return l < r ? -1 : l > r ? 1 : 0
}

/** Округление к ближайшей минорной единице, половина — вверх. */
export function roundHalfUpRat(a: Rat): bigint {
  return floorRat(a) + (2n * (a.n % a.d) >= a.d ? 1n : 0n)
}

/** Наибольшие остатки: каждому floor(q_i), остаток total − Σ floor — по наибольшей дробной части. */
export function largestRemainder(quotas: Rat[], total: bigint): bigint[] {
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
