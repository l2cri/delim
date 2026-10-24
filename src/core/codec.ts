// Операция «кодек» интерфейса ядра: стейт поездки ↔ сжатая lz-string полезная
// нагрузка ссылки-приглашения `#/t=…` (ADR 0007 — весь стейт едет в хэше ссылки,
// без бэкенда; SPEC — импорт all-or-nothing). Кодер доверенный: стейт рождается
// в своём UI и уже валиден схемой, encodeTripState только упаковывает его
// детерминированно, без повторной валидации. Декодер строгий: исключений наружу
// нет, любая причина отказа типизирована; семантику (версия, лимиты, референсы)
// проверяет parseTripState насквозь — кортежи разворачиваются в объект той же
// формы, что хранится в localStorage. Перед сжатием стейт сворачивается в
// компактные кортежи (требование команды): короткие ячейки вместо имён полей
// сжимаются lz-string кратно лучше. Формат кортежей, полезен для отладки ссылок:
//
//   trip        := [SCHEMA_VERSION, name, statusIdx, baseCurrency, currencies[], participants[], expenses[], payments[]]
//   currency    := [code, rate.num, rate.den]
//   participant := [id, name, color, emoji]
//   expense     := [id, title, payerId, amount, currencyCode, createdAt, split]
//   split       := [0, participantIds[]]                    // mode 'equal'
//                | [1, [[participantId, amount], ...]]      // mode 'exact'
//                | [2, [[participantId, weight], ...]]      // mode 'shares'
//   payment     := [id, fromId, toId, amount, currencyCode]
//   statusIdx   := 0 → 'active', 1 → 'completed'

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { parseTripState, type Split, type TripParseError, type TripState } from './schema'

/** Практический предел длины ссылки мессенджеров: UI предупреждает, но не блокирует (ADR 0007). */
export const SHARE_PAYLOAD_WARN = 32_000

/** Жёсткий лимит полезной нагрузки на входе декодера: длиннее — 'too-long', без распаковки (SPEC). */
export const SHARE_PAYLOAD_LIMIT = 100_000

export type TripDecodeError = { kind: 'too-long'; max: number; actual: number } | TripParseError

export type DecodeResult = { ok: true; state: TripState } | { ok: false; error: TripDecodeError }

/** Порядок статусов в кортеже trip: индекс statusIdx ↔ значение схемы. */
const STATUSES = ['active', 'completed'] as const

/**
 * Упаковывает стейт в полезную нагрузку ссылки: поля в порядке схемы → кортежи →
 * JSON → compressToEncodedURIComponent. Детерминирован: один стейт — одна и та
 * же строка (одинаковые ссылки на одинаковых поездках, стабильные тесты).
 */
export function encodeTripState(state: TripState): string {
  const tuples = [
    state.version,
    state.name,
    STATUSES.indexOf(state.status),
    state.baseCurrency,
    state.currencies.map((currency) => [currency.code, currency.rate.num, currency.rate.den]),
    state.participants.map((participant) => [
      participant.id,
      participant.name,
      participant.color,
      participant.emoji,
    ]),
    state.expenses.map((expense) => [
      expense.id,
      expense.title,
      expense.payerId,
      expense.amount,
      expense.currencyCode,
      expense.createdAt,
      encodeSplit(expense.split),
    ]),
    state.payments.map((payment) => [
      payment.id,
      payment.fromId,
      payment.toId,
      payment.amount,
      payment.currencyCode,
    ]),
  ]
  return compressToEncodedURIComponent(JSON.stringify(tuples))
}

function encodeSplit(split: Split): unknown[] {
  switch (split.mode) {
    case 'equal':
      return [0, split.participantIds]
    case 'exact':
      return [1, split.shares.map((share) => [share.participantId, share.amount])]
    case 'shares':
      return [2, split.shares.map((share) => [share.participantId, share.weight])]
  }
}

/**
 * Распаковывает полезную нагрузку ссылки в стейт. Порядок отказов: пустая или
 * из одних пробелов → длиннее SHARE_PAYLOAD_LIMIT ('too-long', без распаковки) →
 * не lz-string → не JSON → не кортежи (короткое место в detail) → причины
 * parseTripState насквозь (damaged/version/limit/references). Исключений нет.
 */
export function decodeTripState(payload: string): DecodeResult {
  if (!payload.trim()) return failed({ kind: 'damaged', detail: 'пустая полезная нагрузка' })
  if (payload.length > SHARE_PAYLOAD_LIMIT) {
    return failed({ kind: 'too-long', max: SHARE_PAYLOAD_LIMIT, actual: payload.length })
  }
  const json = decompressFromEncodedURIComponent(payload)
  if (json === null || json === '') return failed({ kind: 'damaged', detail: 'не удаётся распаковать: не lz-string' })
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return failed({ kind: 'damaged', detail: 'строка не является корректным JSON' })
  }
  const unfolded = unfoldTripTuples(data)
  if (!unfolded.ok) {
    return failed({ kind: 'damaged', detail: `полезная нагрузка не в формате кортежей: ${unfolded.where}` })
  }
  return parseTripState(JSON.stringify(unfolded.value))
}

function failed(error: TripDecodeError): DecodeResult {
  return { ok: false, error }
}

/** Массив ровно из length элементов — базовая форма любой ячейки формата. */
function isTuple(value: unknown, length: number): value is unknown[] {
  return Array.isArray(value) && value.length === length
}

/**
 * Оборонительный разворот кортежей в объект формы localStorage. Не бросает:
 * любое несоответствие форме (не массив, неверная длина, неверный тип,
 * неизвестный тег) — { ok: false, where } с коротким путём до места. Семантику
 * (лимиты, дубликаты, референсы) не проверяет — это территория parseTripState.
 */
function unfoldTripTuples(
  data: unknown,
): { ok: true; value: unknown } | { ok: false; where: string } {
  if (!isTuple(data, 8)) return { ok: false, where: 'trip' }
  const [version, name, statusIdx, baseCurrency, currencies, participants, expenses, payments] = data
  if (typeof version !== 'number') return { ok: false, where: 'trip[0] (версия)' }
  if (typeof name !== 'string') return { ok: false, where: 'trip[1] (название)' }
  if (statusIdx !== 0 && statusIdx !== 1) return { ok: false, where: 'trip[2] (статус)' }
  if (typeof baseCurrency !== 'string') return { ok: false, where: 'trip[3] (базовая валюта)' }
  if (!Array.isArray(currencies)) return { ok: false, where: 'trip[4] (валюты)' }
  if (!Array.isArray(participants)) return { ok: false, where: 'trip[5] (участники)' }
  if (!Array.isArray(expenses)) return { ok: false, where: 'trip[6] (расходы)' }
  if (!Array.isArray(payments)) return { ok: false, where: 'trip[7] (выплаты)' }

  const unfoldedCurrencies = []
  for (let i = 0; i < currencies.length; i++) {
    const currency = currencies[i]
    if (
      !isTuple(currency, 3) ||
      typeof currency[0] !== 'string' ||
      typeof currency[1] !== 'number' ||
      typeof currency[2] !== 'number'
    ) {
      return { ok: false, where: `currencies[${i}]` }
    }
    unfoldedCurrencies.push({ code: currency[0], rate: { num: currency[1], den: currency[2] } })
  }

  const unfoldedParticipants = []
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i]
    if (
      !isTuple(participant, 4) ||
      participant.some((field) => typeof field !== 'string')
    ) {
      return { ok: false, where: `participants[${i}]` }
    }
    const [id, participantName, color, emoji] = participant
    unfoldedParticipants.push({ id, name: participantName, color, emoji })
  }

  const unfoldedExpenses = []
  for (let i = 0; i < expenses.length; i++) {
    const expense = expenses[i]
    if (!isTuple(expense, 7)) return { ok: false, where: `expenses[${i}]` }
    const [id, title, payerId, amount, currencyCode, createdAt, splitTuple] = expense
    if (
      typeof id !== 'string' ||
      typeof title !== 'string' ||
      typeof payerId !== 'string' ||
      typeof amount !== 'number' ||
      typeof currencyCode !== 'string' ||
      typeof createdAt !== 'string'
    ) {
      return { ok: false, where: `expenses[${i}]` }
    }
    const split = unfoldSplit(splitTuple)
    if (!split.ok) return { ok: false, where: `expenses[${i}].split` }
    unfoldedExpenses.push({ id, title, payerId, amount, currencyCode, createdAt, split: split.value })
  }

  const unfoldedPayments = []
  for (let i = 0; i < payments.length; i++) {
    const payment = payments[i]
    if (
      !isTuple(payment, 5) ||
      typeof payment[0] !== 'string' ||
      typeof payment[1] !== 'string' ||
      typeof payment[2] !== 'string' ||
      typeof payment[3] !== 'number' ||
      typeof payment[4] !== 'string'
    ) {
      return { ok: false, where: `payments[${i}]` }
    }
    const [id, fromId, toId, paymentAmount, paymentCurrencyCode] = payment
    unfoldedPayments.push({
      id,
      fromId,
      toId,
      amount: paymentAmount,
      currencyCode: paymentCurrencyCode,
    })
  }

  return {
    ok: true,
    value: {
      version,
      name,
      status: STATUSES[statusIdx],
      baseCurrency,
      currencies: unfoldedCurrencies,
      participants: unfoldedParticipants,
      expenses: unfoldedExpenses,
      payments: unfoldedPayments,
    },
  }
}

/** Разворот сплита: тег 0/1/2 ↔ режимы equal/exact/shares. */
function unfoldSplit(data: unknown): { ok: true; value: unknown } | { ok: false } {
  if (!isTuple(data, 2)) return { ok: false }
  const [tag, rest] = data
  if (tag === 0) {
    if (!Array.isArray(rest) || rest.some((id) => typeof id !== 'string')) return { ok: false }
    return { ok: true, value: { mode: 'equal', participantIds: rest } }
  }
  if (tag === 1 || tag === 2) {
    if (
      !Array.isArray(rest) ||
      !rest.every(
        (pair) => isTuple(pair, 2) && typeof pair[0] === 'string' && typeof pair[1] === 'number',
      )
    ) {
      return { ok: false }
    }
    if (tag === 1) {
      return {
        ok: true,
        value: {
          mode: 'exact',
          shares: rest.map((pair) => ({ participantId: pair[0] as string, amount: pair[1] as number })),
        },
      }
    }
    return {
      ok: true,
      value: {
        mode: 'shares',
        shares: rest.map((pair) => ({ participantId: pair[0] as string, weight: pair[1] as number })),
      },
    }
  }
  return { ok: false }
}
