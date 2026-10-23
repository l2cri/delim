/**
 * Правила ввода, общие для аффордансов кнопок и мутаций useTrip: условие живёт
 * один раз, в стейте — компоненты только спрашивают (AGENTS.md: ноль
 * бизнес-логики в компонентах).
 */

import { splitAmounts } from '../../core'
import type { Split } from '../../core'

/** Строка без значащих символов: имя или код из одних пробелов невалиден. */
export function isBlank(value: string): boolean {
  return value.trim() === ''
}

/** Расхождение сплита с суммой расхода (минорные единицы): amount − Σ долей.
 * Для equal/shares всегда 0; для exact — насколько введённые суммы не покрывают расход
 * (>0 — не хватает, <0 — лишнее). */
export function splitDelta(amount: number, split: Split): number {
  const covered = splitAmounts(amount, split).reduce((sum, share) => sum + share.amount, 0)
  return amount - covered
}
