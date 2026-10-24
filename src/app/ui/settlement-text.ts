// Формулировки седения, общие для секции «Сведение» и квитанции: одна копия
// слов в одном модуле, чтобы экран и текст для мессенджера не разъезжались
// (вынесено по P3 ревью #14 — синхронизация держалась на комментарии).

import { formatMinor } from './format'

/** Тон баланса для цвета на экране: кредит / долг / ноль. */
export type BalanceTone = 'credit' | 'debt' | 'zero'

/** Пустое состояние списка переводов — общая строка сечения и квитанции. */
export const NO_TRANSFERS_TEXT = 'Переводов нет — все в нуле'

/**
 * Подпись баланса без валюты (валюту дописывает вызывающий — экран суффиксом,
 * квитанция называет её в заголовке блока): amount > 0 → «должны ему 666,66»
 * (credit), amount < 0 → «должен 333,33» (debt), 0 → «в нуле» (zero).
 */
export function balancePhrase(amount: number): { text: string; tone: BalanceTone } {
  if (amount > 0) return { text: `должны ему ${formatMinor(amount)}`, tone: 'credit' }
  if (amount < 0) return { text: `должен ${formatMinor(-amount)}`, tone: 'debt' }
  return { text: 'в нуле', tone: 'zero' }
}
