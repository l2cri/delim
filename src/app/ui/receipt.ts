// Квитанция — шеринг поездки текстом (тикет 14, User Story 26): чистая сборка
// строки для мессенджера из стейта поездки. Балансы и сведение считает только
// ядро (computeBalances → settle); здесь — раскладка по строкам и форматирование
// сумм formatMinor. Формат фиксирован: один моноширинный фенс-блок ```…```
// (мессенджеры показывают его моноширинным), каждая строка самодостаточна
// «имя — значение» без выравнивающей добивки — длинные имена не ломают блок.
// PNG, canvas и Web Share запрещены спекой: квитанция — только текст в буфер.

import type { TripState } from '../../core'
import { computeBalances, settle } from '../../core'
import { formatMinor } from './format'
import { balancePhrase, NO_TRANSFERS_TEXT } from './settlement-text'

/** «2026-10-01T…» → «01.10.2026»: день берётся прямо из ISO-строки, без
 * new Date — вывод не зависит от таймзоны устройства. */
function ruDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/**
 * Собирает текст квитанции: шапка (поездка, даты, участники, счётчики) и один
 * фенс-блок с балансами и переводами. Пустая поездка (нет участников) — без
 * фенсов, двумя объясняющими строками; участники без расходов — обычная
 * структура: все «в нуле», «Переводов нет — все в нуле», строки «Даты» и
 * «Расходов» отсутствуют.
 */
export function buildReceipt(trip: TripState): string {
  const lines: string[] = ['Делим · квитанция', '', `Поездка: ${trip.name}`]

  // Даты — по расходам и только по ним: у поездки нет своих дат (SPEC).
  // День создания — первые 10 символов ISO; YYYY-MM-DD лексикографически
  // хронологичен, поэтому min/max — это сортировка строк.
  if (trip.expenses.length > 0) {
    const days = trip.expenses.map((expense) => expense.createdAt.slice(0, 10)).sort()
    const first = ruDate(days[0])
    const last = ruDate(days[days.length - 1])
    lines.push(first === last ? `Даты: ${first}` : `Даты: ${first} — ${last}`)
  }

  if (trip.participants.length > 0) {
    lines.push(`Участники: ${trip.participants.map((p) => p.name).join(', ')}`)
  }
  if (trip.expenses.length + trip.payments.length > 0) {
    lines.push(`Расходов: ${trip.expenses.length} · Выплат: ${trip.payments.length}`)
  }

  // Пустая поездка: без участников не бывает ни расходов, ни выплат (ссылки
  // стейта указывают на участников), показывать балансы нечего — объясняем,
  // что наполнит квитанцию.
  if (trip.participants.length === 0) {
    lines.push('', 'Участников и расходов пока нет.')
    lines.push('Балансы и переводы появятся, когда добавите участников и расходы.')
    return lines.join('\n')
  }

  // Стыковка записей ядра с именами — по id через Map, как в сечении: на
  // валидном стейте запись есть на каждого участника, «—» — нейтральная
  // страховка чужого референса вместо падения.
  const byId = new Map(trip.participants.map((p) => [p.id, p]))
  const balances = computeBalances(trip)
  const transfers = settle(balances)

  lines.push(
    '',
    '```',
    `Балансы · ${trip.baseCurrency}`,
    ...balances.map((entry) => {
      const name = byId.get(entry.participantId)?.name ?? '—'
      return `${name} — ${balancePhrase(entry.amount).text}`
    }),
    '',
    `Переводы · ${trip.baseCurrency}`,
    ...(transfers.length > 0
      ? transfers.map(
          (transfer) =>
            `${byId.get(transfer.fromId)?.name ?? '—'} → ${byId.get(transfer.toId)?.name ?? '—'} ${formatMinor(transfer.amount)}`,
        )
      : [NO_TRANSFERS_TEXT]),
    '```',
  )
  return lines.join('\n')
}
