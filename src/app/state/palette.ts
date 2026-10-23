/**
 * Палитры аватаров участника: автоподбор цвета и эмодзи без ручной настройки.
 * Чистые функции без Vue — стратегия выбора проверяема отдельно от композабла.
 */

/** 16 различимых цветов: оснéкованные акценты Tailwind, различимы и в тёмной теме. */
export const PALETTE_COLORS: readonly string[] = [
  '#059669',
  '#2563eb',
  '#7c3aed',
  '#d97706',
  '#e11d48',
  '#0891b2',
  '#ea580c',
  '#4f46e5',
  '#65a30d',
  '#c026d3',
  '#0d9488',
  '#dc2626',
  '#0284c7',
  '#db2777',
  '#16a34a',
  '#ca8a04',
]

/** 16 различимых эмодзи-животных: читаемы в списках и графе долгов при мелком кегле. */
export const PALETTE_EMOJI: readonly string[] = [
  '🐻',
  '🦊',
  '🐼',
  '🐸',
  '🦁',
  '🐯',
  '🐨',
  '🐷',
  '🐵',
  '🦉',
  '🐧',
  '🐙',
  '🦄',
  '🐢',
  '🦩',
  '🐳',
]

/** Счёт использований значений палитры по списку занятых. */
function countUses(used: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of used) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

/**
 * Детерминированный автоподбор при добавлении: наименее используемое значение,
 * при ничьей — первое по порядку палитры. Пока участников меньше палитры, выдаёт
 * свободные значения, поэтому первые 16 аватаров попарно различны.
 */
export function pickLeastUsed(palette: readonly string[], used: readonly string[]): string {
  const counts = countUses(used)
  // Палитры непусты по построению; пустой вход — пустая строка, без cast-обмана типов.
  let best = ''
  let bestCount = Number.POSITIVE_INFINITY
  for (const value of palette) {
    const count = counts.get(value) ?? 0
    if (count < bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * Перегенерация аватара: равновероятный выбор среди наименее используемых значений
 * палитры, исключая текущее — кубик, а не пинг-понг между двумя значениями.
 * Пока в палитре есть свободные значения, бросок всегда даёт свободное значение,
 * поэтому уникальность аватаров переживает перегенерацию. Если исключать нечего
 * (палитра из одного значения), возвращается оно же.
 */
export function pickLeastUsedRandom(
  palette: readonly string[],
  used: readonly string[],
  exclude: string,
): string {
  const counts = countUses(used)
  let minCount = Number.POSITIVE_INFINITY
  const candidates: string[] = []
  for (const value of palette) {
    if (value === exclude) continue
    const count = counts.get(value) ?? 0
    if (count < minCount) {
      minCount = count
      candidates.length = 0
      candidates.push(value)
    } else if (count === minCount) {
      candidates.push(value)
    }
  }
  if (candidates.length === 0) return exclude
  return candidates[randomIndex(candidates.length)]
}

/** Равномерный случайный индекс [0, bound): crypto-энтропия без смещения деления. */
function randomIndex(bound: number): number {
  const buf = new Uint32Array(1)
  const limit = 2 ** 32 - (2 ** 32 % bound)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limit)
  return buf[0] % bound
}
