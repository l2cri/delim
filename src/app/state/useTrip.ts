import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { createNewTrip, parseTripState, TRIP_LIMITS } from '../../core'
import type {
  Expense,
  Participant,
  Rational,
  Split,
  TripParseError,
  TripState,
} from '../../core'
import { PALETTE_COLORS, PALETTE_EMOJI, pickLeastUsed, pickLeastUsedRandom } from './palette'
import { clearStoredTrip, readStoredTrip, writeStoredTrip } from './storage'
import { isBlank, splitDelta } from './validation'

/**
 * Единственный владелец мутируемого стейта поездки (ADR 0009: композабл без Pinia).
 * Синглтон на уровне модуля: синхронная загрузка из localStorage при первом обращении,
 * автосохранение с дебаунсом ~500 мс (ADR 0008). Компоненты меняют стейт только
 * через эти мутации и никогда не знают о хранилище.
 */

const SAVE_DEBOUNCE_MS = 500

export type CreateTripResult =
  | { ok: true }
  | { ok: false; reason: 'empty-name' | 'empty-currency' }

export type AddParticipantResult =
  | { ok: true; participant: Participant }
  | { ok: false; reason: 'empty-name' }
  | { ok: false; reason: 'limit'; max: number }

export type RenameParticipantResult =
  | { ok: true }
  | { ok: false; reason: 'empty-name' | 'not-found' }

export type RemoveParticipantResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'in-use'; expenses: number; payments: number }

/** Вход мутаций расхода: сплит предусловием построен валидным UI, useTrip не пересобирает. */
export type ExpenseInput = {
  title: string
  payerId: string
  amount: number // целые минорные единицы, > 0
  currencyCode: string
  split: Split
}

export type SaveExpenseResult =
  | { ok: true; expense: Expense }
  | { ok: false; reason: 'empty-title' }
  | { ok: false; reason: 'bad-amount' }
  | { ok: false; reason: 'empty-split' }
  | { ok: false; reason: 'limit'; max: number }
  | { ok: false; reason: 'unknown-participant'; id: string }
  | { ok: false; reason: 'unknown-currency'; code: string }
  | { ok: false; reason: 'split-mismatch'; delta: number }
  | { ok: false; reason: 'not-found' } // только updateExpense

export type RemoveExpenseResult = { ok: true } | { ok: false; reason: 'not-found' }

export type AddCurrencyResult =
  | { ok: true }
  | { ok: false; reason: 'empty-code' }
  | { ok: false; reason: 'duplicate'; code: string }
  | { ok: false; reason: 'limit'; max: number }
  | { ok: false; reason: 'bad-rate' }

export type UpdateCurrencyRateResult =
  | { ok: true }
  | { ok: false; reason: 'not-found'; code: string }
  | { ok: false; reason: 'base-currency'; code: string }
  | { ok: false; reason: 'bad-rate' }

export type RemoveCurrencyResult =
  | { ok: true }
  | { ok: false; reason: 'not-found'; code: string }
  | { ok: false; reason: 'base-currency'; code: string }
  | { ok: false; reason: 'in-use'; expenses: number; payments: number }

// Стейт живёт на уровне модуля: все вызовы useTrip() внутри приложения смотрят
// на одни и те же refs — один способ хранения, один автосейв.
const trip = ref<TripState | null>(null)
const loadError = ref<TripParseError | null>(null)

{
  const raw = readStoredTrip()
  if (raw !== null && raw !== '') {
    const parsed = parseTripState(raw)
    if (parsed.ok) {
      trip.value = parsed.state
    } else {
      // Повреждённые или чужие данные не роняют приложение: экран покажет причину.
      loadError.value = parsed.error
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Немедленная запись отложенного сохранения (закрытие вкладки не ждёт дебаунса). */
function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (trip.value !== null) writeStoredTrip(trip.value)
}

watch(
  trip,
  () => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (trip.value !== null) writeStoredTrip(trip.value)
    }, SAVE_DEBOUNCE_MS)
  },
  { deep: true },
)

window.addEventListener('beforeunload', flushSave)

/** Мутации участников осмысленны только при существующей поездке — инвариант UI. */
function requireTrip(): TripState {
  if (trip.value === null) throw new Error('поездка не создана')
  return trip.value
}

function findParticipant(id: string): Participant | undefined {
  return trip.value?.participants.find((p) => p.id === id)
}

/** Участник упомянут в сплите — в любом из трёх режимов: equal списком id,
 * точные суммы и доли — одним и тем же списком долей. */
function splitMentions(split: Split, id: string): boolean {
  if (split.mode === 'equal') return split.participantIds.includes(id)
  return split.shares.some((s) => s.participantId === id)
}

/** Участники сплита списком id в порядке следования: equal — participantIds,
 * точные суммы и доли — id из того же списка долей. */
function splitIds(split: Split): string[] {
  return split.mode === 'equal' ? split.participantIds : split.shares.map((s) => s.participantId)
}

function createTrip(input: { name: string; baseCurrency: string }): CreateTripResult {
  if (isBlank(input.name)) return { ok: false, reason: 'empty-name' }
  if (isBlank(input.baseCurrency)) return { ok: false, reason: 'empty-currency' }
  // Обрезку пробелов делает ядро (createNewTrip); здесь только типизированный отказ.
  trip.value = createNewTrip(input)
  loadError.value = null
  return { ok: true }
}

function addParticipant(name: string): AddParticipantResult {
  if (isBlank(name)) return { ok: false, reason: 'empty-name' }
  const trimmed = name.trim()
  const current = requireTrip()
  if (current.participants.length >= TRIP_LIMITS.participants) {
    return { ok: false, reason: 'limit', max: TRIP_LIMITS.participants }
  }
  const participant: Participant = {
    id: crypto.randomUUID(),
    name: trimmed,
    color: pickLeastUsed(
      PALETTE_COLORS,
      current.participants.map((p) => p.color),
    ),
    emoji: pickLeastUsed(
      PALETTE_EMOJI,
      current.participants.map((p) => p.emoji),
    ),
  }
  current.participants.push(participant)
  return { ok: true, participant }
}

function renameParticipant(id: string, name: string): RenameParticipantResult {
  if (isBlank(name)) return { ok: false, reason: 'empty-name' }
  const trimmed = name.trim()
  requireTrip()
  const participant = findParticipant(id)
  if (!participant) return { ok: false, reason: 'not-found' }
  participant.name = trimmed
  return { ok: true }
}

function removeParticipant(id: string): RemoveParticipantResult {
  const current = requireTrip()
  if (!current.participants.some((p) => p.id === id)) {
    return { ok: false, reason: 'not-found' }
  }
  const expenses = current.expenses.filter(
    (e) => e.payerId === id || splitMentions(e.split, id),
  ).length
  const payments = current.payments.filter((p) => p.fromId === id || p.toId === id).length
  if (expenses > 0 || payments > 0) {
    return { ok: false, reason: 'in-use', expenses, payments }
  }
  current.participants = current.participants.filter((p) => p.id !== id)
  return { ok: true }
}

/**
 * Общие проверки входа расхода в едином порядке (детерминированном для тестов):
 * название → сумма → лимит → непустой сплит → участники → валюта → сходимость сплита.
 * null — вход годен. Лимит спрашивает только добавление: обновление не растит список.
 */
function expenseInputError(
  current: TripState,
  input: ExpenseInput,
  withLimit: boolean,
): SaveExpenseResult | null {
  if (isBlank(input.title)) return { ok: false, reason: 'empty-title' }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, reason: 'bad-amount' }
  }
  if (withLimit && current.expenses.length >= TRIP_LIMITS.expenses) {
    return { ok: false, reason: 'limit', max: TRIP_LIMITS.expenses }
  }
  if (splitIds(input.split).length === 0) return { ok: false, reason: 'empty-split' }
  const knownIds = new Set(current.participants.map((p) => p.id))
  if (!knownIds.has(input.payerId)) {
    return { ok: false, reason: 'unknown-participant', id: input.payerId }
  }
  for (const participantId of splitIds(input.split)) {
    if (!knownIds.has(participantId)) {
      return { ok: false, reason: 'unknown-participant', id: participantId }
    }
  }
  if (!current.currencies.some((c) => c.code === input.currencyCode)) {
    return { ok: false, reason: 'unknown-currency', code: input.currencyCode }
  }
  const delta = splitDelta(input.amount, input.split)
  if (delta !== 0) return { ok: false, reason: 'split-mismatch', delta }
  return null
}

function addExpense(input: ExpenseInput): SaveExpenseResult {
  const current = requireTrip()
  const error = expenseInputError(current, input, true)
  if (error) return error
  const expense: Expense = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    payerId: input.payerId,
    amount: input.amount,
    currencyCode: input.currencyCode,
    createdAt: new Date().toISOString(),
    split: input.split,
  }
  current.expenses.push(expense)
  return { ok: true, expense }
}

function updateExpense(id: string, input: ExpenseInput): SaveExpenseResult {
  const current = requireTrip()
  const target = current.expenses.find((e) => e.id === id)
  if (!target) return { ok: false, reason: 'not-found' }
  const error = expenseInputError(current, input, false)
  if (error) return error
  // id и createdAt — идентичность записи, они неприкосновенны; остальное заменяется.
  target.title = input.title.trim()
  target.payerId = input.payerId
  target.amount = input.amount
  target.currencyCode = input.currencyCode
  target.split = input.split
  return { ok: true, expense: target }
}

function removeExpense(id: string): RemoveExpenseResult {
  const current = requireTrip()
  const kept = current.expenses.filter((e) => e.id !== id)
  if (kept.length === current.expenses.length) return { ok: false, reason: 'not-found' }
  current.expenses = kept
  return { ok: true }
}

/** Курс — положительные безопасные целые пары, контракт Rational схемы; в рантайме
 * прийти может любое (UI присылает результат parseRate, но мутация защищает схему
 * сама — как expenseInputError защищает расход). */
function isSafeRate(rate: Rational): boolean {
  return (
    Number.isInteger(rate.num) &&
    rate.num > 0 &&
    rate.num <= Number.MAX_SAFE_INTEGER &&
    Number.isInteger(rate.den) &&
    rate.den > 0 &&
    rate.den <= Number.MAX_SAFE_INTEGER
  )
}

function addCurrency(code: string, rate: Rational): AddCurrencyResult {
  if (isBlank(code)) return { ok: false, reason: 'empty-code' }
  const trimmed = code.trim()
  const current = requireTrip()
  if (current.currencies.some((c) => c.code === trimmed)) {
    return { ok: false, reason: 'duplicate', code: trimmed }
  }
  if (current.currencies.length >= TRIP_LIMITS.currencies) {
    return { ok: false, reason: 'limit', max: TRIP_LIMITS.currencies }
  }
  if (!isSafeRate(rate)) return { ok: false, reason: 'bad-rate' }
  current.currencies.push({ code: trimmed, rate })
  return { ok: true }
}

function updateCurrencyRate(code: string, rate: Rational): UpdateCurrencyRateResult {
  const current = requireTrip()
  const target = current.currencies.find((c) => c.code === code)
  if (!target) return { ok: false, reason: 'not-found', code }
  if (code === current.baseCurrency) return { ok: false, reason: 'base-currency', code }
  if (!isSafeRate(rate)) return { ok: false, reason: 'bad-rate' }
  // Живое значение (ADR 0005): расходов и балансов не касается — они читают курс
  // из стейта при каждом вычислении, пересчёт задним числом происходит сам.
  target.rate = rate
  return { ok: true }
}

function removeCurrency(code: string): RemoveCurrencyResult {
  const current = requireTrip()
  if (!current.currencies.some((c) => c.code === code)) {
    return { ok: false, reason: 'not-found', code }
  }
  // Базовая валюта неприкосновенна: схема требует её ровно один раз с курсом 1/1.
  if (code === current.baseCurrency) return { ok: false, reason: 'base-currency', code }
  const expenses = current.expenses.filter((e) => e.currencyCode === code).length
  const payments = current.payments.filter((p) => p.currencyCode === code).length
  if (expenses > 0 || payments > 0) {
    return { ok: false, reason: 'in-use', expenses, payments }
  }
  current.currencies = current.currencies.filter((c) => c.code !== code)
  return { ok: true }
}

function regenerateAvatar(id: string): void {
  const current = requireTrip()
  const participant = current.participants.find((p) => p.id === id)
  if (!participant) return
  // Кубик: равновероятно среди наименее занятых, текущее исключено — иначе
  // бросок навсегда зацикливался бы между двумя значениями.
  participant.color = pickLeastUsedRandom(
    PALETTE_COLORS,
    current.participants.map((p) => p.color),
    participant.color,
  )
  participant.emoji = pickLeastUsedRandom(
    PALETTE_EMOJI,
    current.participants.map((p) => p.emoji),
    participant.emoji,
  )
}

function discardCorrupted(): void {
  clearStoredTrip()
  loadError.value = null
}

export function useTrip(): {
  trip: Readonly<Ref<TripState | null>>
  loadError: Readonly<Ref<TripParseError | null>>
  createTrip(input: { name: string; baseCurrency: string }): CreateTripResult
  addParticipant(name: string): AddParticipantResult
  renameParticipant(id: string, name: string): RenameParticipantResult
  removeParticipant(id: string): RemoveParticipantResult
  addExpense(input: ExpenseInput): SaveExpenseResult
  updateExpense(id: string, input: ExpenseInput): SaveExpenseResult
  removeExpense(id: string): RemoveExpenseResult
  addCurrency(code: string, rate: Rational): AddCurrencyResult
  updateCurrencyRate(code: string, rate: Rational): UpdateCurrencyRateResult
  removeCurrency(code: string): RemoveCurrencyResult
  regenerateAvatar(id: string): void
  discardCorrupted(): void
} {
  return {
    trip,
    loadError,
    createTrip,
    addParticipant,
    renameParticipant,
    removeParticipant,
    addExpense,
    updateExpense,
    removeExpense,
    addCurrency,
    updateCurrencyRate,
    removeCurrency,
    regenerateAvatar,
    discardCorrupted,
  }
}
