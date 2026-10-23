import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import { createNewTrip, parseTripState, TRIP_LIMITS } from '../../core'
import type { Participant, Split, TripParseError, TripState } from '../../core'
import { PALETTE_COLORS, PALETTE_EMOJI, pickLeastUsed, pickLeastUsedRandom } from './palette'

/**
 * Единственный владелец мутируемого стейта поездки (ADR 0009: композабл без Pinia).
 * Синглтон на уровне модуля: синхронная загрузка из localStorage при первом обращении,
 * автосохранение с дебаунсом ~500 мс (ADR 0008). Компоненты меняют стейт только
 * через эти мутации и никогда не знают о хранилище.
 */

const STORAGE_KEY = 'delim:active-trip'
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

// Стейт живёт на уровне модуля: все вызовы useTrip() внутри приложения смотрят
// на одни и те же refs — один способ хранения, один автосейв.
const trip = ref<TripState | null>(null)
const loadError = ref<TripParseError | null>(null)

{
  const raw = localStorage.getItem(STORAGE_KEY)
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
  if (trip.value !== null) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip.value))
  }
}

watch(
  trip,
  () => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      if (trip.value !== null) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trip.value))
      }
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

/** Участник упомянут в сплите — в любом из трёх режимов. */
function splitMentions(split: Split, id: string): boolean {
  switch (split.mode) {
    case 'equal':
      return split.participantIds.includes(id)
    case 'exact':
      return split.shares.some((s) => s.participantId === id)
    case 'shares':
      return split.shares.some((s) => s.participantId === id)
  }
}

function createTrip(input: { name: string; baseCurrency: string }): CreateTripResult {
  const name = input.name.trim()
  if (!name) return { ok: false, reason: 'empty-name' }
  const baseCurrency = input.baseCurrency.trim()
  if (!baseCurrency) return { ok: false, reason: 'empty-currency' }
  trip.value = createNewTrip({ name, baseCurrency })
  loadError.value = null
  return { ok: true }
}

function addParticipant(name: string): AddParticipantResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'empty-name' }
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
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'empty-name' }
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
  localStorage.removeItem(STORAGE_KEY)
  loadError.value = null
}

export function useTrip(): {
  trip: Readonly<Ref<TripState | null>>
  loadError: Readonly<Ref<TripParseError | null>>
  createTrip(input: { name: string; baseCurrency: string }): CreateTripResult
  addParticipant(name: string): AddParticipantResult
  renameParticipant(id: string, name: string): RenameParticipantResult
  removeParticipant(id: string): RemoveParticipantResult
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
    regenerateAvatar,
    discardCorrupted,
  }
}
