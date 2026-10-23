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
// тоже bigint, перевод в number на выходе. Квоты, доли и конвертация — общие с
// разбиением сплитов для UI (splits.ts) примитивы в ./internal — гроссбух и показ
// долей до сохранения расхода считают одинаково. Предусловие контракта: итоговые
// балансы помещаются в Number.MAX_SAFE_INTEGER. Вход — валидный TripState (создан
// createNewTrip/parseTripState): операция чистая и детерминированная, повторной
// валидации не выполняет.

import type { TripState } from './schema'
import { convertAmount, splitConverted, splitParticipantIds } from './internal/split'

/** Баланс участника: целые минорные единицы базовой валюты. */
export interface BalanceEntry {
  participantId: string
  amount: number
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
    const { total: consumed, shares } = splitConverted(expense.split, expense.amount, rate)
    apply(expense.payerId, consumed)
    for (const [i, id] of splitParticipantIds(expense.split).entries()) {
      apply(id, -shares[i])
    }
  }

  for (const payment of state.payments) {
    const rate = rates.get(payment.currencyCode)!
    const converted = convertAmount(payment.amount, rate)
    apply(payment.fromId, -converted)
    apply(payment.toId, converted)
  }

  return state.participants.map((participant) => ({
    participantId: participant.id,
    amount: Number(balances.get(participant.id)),
  }))
}
