// Производный входной разбор курса — зеркальный к convertToBase (splits.ts):
// настройки вводят курс валюты десятичной дробью, а ядро хранит и считает его
// точным рациональным num/den (ADR 0005 — живые ручные курсы, ADR 0004 — точные
// рациональные курсы вместо float). Оболочка денег не считает, поэтому разбор
// дроби в несократимую пару — задача ядра. Отказы без исключений (ok:false),
// как у evalExpr; операция чистая и детерминированная, удачный результат уже
// удовлетворяет контракту Rational схемы (положительные безопасные целые),
// повторной валидации не требуется.

import type { Rational } from './schema'
import { rat } from './internal/rat'

/** Результат разбора курса: точное рациональное число либо некорректно. */
export type ParseRateResult = { ok: true; rate: Rational } | { ok: false }

/** Предел дробной части: 10^15 — ещё безопасное целое (10^16 уже нет); длиннее — мусорный ввод, отсекается до арифметики. */
const MAX_FRAC_DIGITS = 15

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Разбирает курс из десятичной дроби: только цифры и максимум один разделитель
 * (запятая и точка равнозначны), целая («3.») либо дробная («,5») часть может
 * отсутствовать, хотя бы одна цифра обязательна. Порядок отказов: пустая строка
 * после обрезки → посторонние символы (знак, пробел внутри, второй разделитель,
 * выражения) → ноль → длиннее 15 дробных цифр → числитель или знаменатель после
 * сокращения больше Number.MAX_SAFE_INTEGER.
 */
export function parseRate(input: string): ParseRateResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false } // пусто или одни пробелы

  // Формат: \d* [.,]? \d* — всё посторонее (знак, «1/2», «1 000», «1,2.3», буквы)
  // отсекается здесь; отсутствие обеих частей — ниже, минимумом одной цифры.
  const match = /^(\d*)([.,]?)(\d*)$/.exec(trimmed)
  if (!match) return { ok: false }
  const intDigits = match[1]
  const fracDigits = match[3]
  if (intDigits.length + fracDigits.length === 0) return { ok: false } // «,» или «.»

  const num = BigInt(intDigits + fracDigits)
  if (num === 0n) return { ok: false } // курс строго положительный («0», «0,0», «,00»)
  if (fracDigits.length > MAX_FRAC_DIGITS) return { ok: false }

  const reduced = rat(num, 10n ** BigInt(fracDigits.length))
  // Контракт схемы: num и den — положительные безопасные целые.
  if (reduced.n > MAX_SAFE || reduced.d > MAX_SAFE) return { ok: false }
  return { ok: true, rate: { num: Number(reduced.n), den: Number(reduced.d) } }
}
