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

/**
 * Наименее используемое значение палитры по списку занятых; при ничьей — первое
 * по порядку палитры (детерминированность). Пока участников меньше палитры,
 * выдаёт свободные значения, поэтому первые 16 аватаров попарно различны.
 * exclude убирает одно значение из кандидатов — перегенерация обязана дать
 * значение, отличное от текущего; если исключать больше нечего (палитра из
 * одного значения), возвращается оно само.
 */
export function pickLeastUsed(
  palette: readonly string[],
  used: readonly string[],
  exclude?: string,
): string {
  const counts = new Map<string, number>()
  for (const value of used) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = Number.POSITIVE_INFINITY
  for (const value of palette) {
    if (exclude !== undefined && value === exclude) continue
    const count = counts.get(value) ?? 0
    if (count < bestCount) {
      best = value
      bestCount = count
    }
  }
  return best ?? (exclude as string)
}
