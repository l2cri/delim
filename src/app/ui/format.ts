// Форматирование денежных сумм для интерфейса: минорные единицы → русская строка.
// Без Intl: ручная сборка, дробная часть — ровно два знака после запятой.

/** Общий помощник: grouped — разделять ли целую часть группами по 3 (U+00A0). */
function format(minor: number, grouped: boolean): string {
  const digits = String(Math.abs(minor)).padStart(3, '0')
  const intDigits = digits.slice(0, -2)
  const separated = grouped
    ? intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
    : intDigits
  const sign = minor < 0 ? '-' : ''
  return `${sign}${separated},${digits.slice(-2)}`
}

/**
 * Целое безопасное число минорных единиц → строка ровно с двумя знаками после
 * запятой, разряды целой части группами по 3 через неразрывный пробел U+00A0:
 * 57500 → «575,00», 5 → «0,05», 0 → «0,00», -200 → «-2,00»,
 * 150050 → «1 500,50» (с U+00A0), 100000000 → «1 000 000,00».
 */
export function formatMinor(minor: number): string {
  return format(minor, true)
}

/** То же без разделителей групп: 150050 → «1500,50», 5 → «0,05», -200 → «-2,00» —
 * такой черновик парсится обратно evalExpr, поэтому им сидируется поле извне. */
export function formatMinorPlain(minor: number): string {
  return format(minor, false)
}
