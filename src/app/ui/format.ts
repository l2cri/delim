// Форматирование денежных сумм для интерфейса: минорные единицы → русская строка.
// Без Intl: ручная сборка, разделитель групп целой части — неразрывный пробел U+00A0.

/**
 * Целое безопасное число минорных единиц → строка ровно с двумя знаками после
 * запятой: 57500 → «575,00», 5 → «0,05», 0 → «0,00», -200 → «-2,00»,
 * 150050 → «1 500,50» (с U+00A0), 100000000 → «1 000 000,00».
 */
export function formatMinor(minor: number): string {
  const digits = String(Math.abs(minor)).padStart(3, '0')
  const intDigits = digits.slice(0, -2)
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
  const sign = minor < 0 ? '-' : ''
  return `${sign}${grouped},${digits.slice(-2)}`
}
