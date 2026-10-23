// Форматирование денежных сумм для интерфейса: минорные единицы → русская строка.
// Без Intl: ручная сборка, дробная часть — ровно два знака после запятой.

import type { Rational } from '../../core'

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

/** Русские склонения: plural(1, «расходе», «расходах», «расходах») → «расходе». */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/**
 * Курс валюты — точное рациональное num/den — в десятичную строку с запятой:
 * 3/1 → «3», 59/20 → «2,95», 1/2 → «0,5». Введённые курсом дроби всегда
 * конечны (den — делитель степени десятки), поэтому деление — до нулевого
 * остатка; защитный потолок 15 знаков — на случай произвольных рациональных
 * курсов из ссылки (тикет 15), хвост просто обрезается.
 */
export function formatRate(rate: Rational): string {
  const den = BigInt(rate.den)
  let rest = BigInt(rate.num)
  const digits: string[] = []
  const intPart = rest / den
  rest %= den
  while (rest !== 0n && digits.length < 15) {
    rest *= 10n
    digits.push(String(rest / den))
    rest %= den
  }
  return digits.length === 0 ? String(intPart) : `${intPart},${digits.join('')}`
}
