// Операция «разбиение сплита» — производное денежное отображение правил гроссбуха
// (balances.ts) для оболочки: UI показывает доли участников до сохранения расхода
// и сумму «в базовой валюте» до вычисления балансов. Оболочка денег не считает —
// квоты, наибольшие остатки и округление живут в ядре, здесь только их вызов.
//
// splitAmounts делит сумму в валюте самого расхода: то же вычисление, что и доли
// расхода в computeBalances при курсе 1/1 (общая пропорциональная часть — в
// ./internal/split), поэтому показанные доли совпадают с будущими балансами.
// exact передаётся как введено: Σ долей может не равняться сумме расхода — это
// забота вызывающего (UI блокирует сохранение такого расхода, схема допускает).
//
// Предусловия — как у остального ядра: amount — целое > 0, split валиден по схеме;
// операции чистые и детерминированные, повторной валидации не выполняют.

import type { Rational, Split } from './schema'
import { convertAmount, splitConverted, splitParticipantIds, UNIT_RATE } from './internal/split'

/** Доля участника в сплите: целые минорные единицы в валюте самого расхода. */
export interface SplitAmount {
  participantId: string
  amount: number
}

/**
 * Разбивает сумму расхода по участникам сплита, в порядке participantIds/shares:
 * equal — квоты amount/k, shares — amount·w_i/W, целые доли наибольшими остатками
 * до Σ ровно amount (тай-брейк равных дробных частей — порядок в сплите);
 * exact — как введено, без пересчёта.
 */
export function splitAmounts(amount: number, split: Split): readonly SplitAmount[] {
  const { shares } = splitConverted(split, amount, UNIT_RATE)
  const participantIds = splitParticipantIds(split)
  return participantIds.map((participantId, i) => ({
    participantId,
    amount: Number(shares[i]),
  }))
}

/**
 * Конвертация суммы в базовую валюту по курсу: roundHalfUp(amount × num / den) —
 * та же схема округления, что и у конвертации выплат в computeBalances.
 */
export function convertToBase(amount: number, rate: Rational): number {
  return Number(convertAmount(amount, rate))
}
