import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewTrip, parseTripState } from '../../core'
import type { TripState } from '../../core'
import { ARCHIVE_STORAGE_KEY, STORAGE_KEY } from './storage'
import { flushWatchers } from '../../../tests/helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/** Свежий синглтон на тест: сброс реестра модулей + динамический импорт = «перезагрузка». */
async function loadUseTrip() {
  return await import('./useTrip')
}

/** Активная поездка с двумя участниками (Аня, Боря), RUB — сцена цикла архива. */
async function loadTripWithParticipants() {
  const { useTrip } = await loadUseTrip()
  const t = useTrip()
  t.createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  const ids = ['Аня', 'Боря'].map((name) => {
    const added = t.addParticipant(name)
    if (!added.ok) throw new Error('участник не добавился')
    return added.participant.id
  })
  return { t, anya: ids[0], borya: ids[1] }
}

/** Валидный стейт завершённой поездки — посев архивного ключа до загрузки модуля. */
function completedTripState(): TripState {
  const state = createNewTrip({ name: 'Прошлая', baseCurrency: 'EUR' })
  state.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
  state.expenses.push({
    id: 'e1',
    title: 'Ужин',
    payerId: 'p1',
    amount: 2400,
    currencyCode: 'EUR',
    createdAt: ISO,
    split: { mode: 'equal', participantIds: ['p1'] },
  })
  state.status = 'completed'
  return state
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('finishTrip: архивация', () => {
  it('поездка с расходами уходит в архив со статусом completed, активный ключ чист', async () => {
    const { t, anya, borya } = await loadTripWithParticipants()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })
    if (!added.ok) throw new Error('расход не добавился')
    const active = t.trip.value as TripState

    expect(t.finishTrip()).toEqual({ ok: true })

    expect(t.trip.value).toBeNull()
    // Та же поездка — целиком, со статусом completed (участники не теряются).
    expect(t.archivedTrip.value).toEqual(active)
    expect(t.archivedTrip.value?.status).toBe('completed')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // Сырой ключ парсится ядром — гарантия для ссылки-зрителя архивной поездки (тикет 15).
    const raw = localStorage.getItem(ARCHIVE_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = parseTripState(raw as string)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.state.status).toBe('completed')
    expect(parsed.state.name).toBe('Кипр')
  })

  it('поездка только с выплатами (без расходов) тоже архивируется', async () => {
    const { t, anya, borya } = await loadTripWithParticipants()
    const paid = t.addPayment({ fromId: borya, toId: anya, amount: 500 })
    if (!paid.ok) throw new Error('выплата не добавилась')

    expect(t.finishTrip()).toEqual({ ok: true })

    expect(t.trip.value).toBeNull()
    expect(t.archivedTrip.value?.status).toBe('completed')
    expect(t.archivedTrip.value?.payments).toHaveLength(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).not.toBeNull()
  })

  it('пустая поездка (участники есть, расходов и выплат нет) не архивируется', async () => {
    // Оба ключа засеяны до загрузки: отказ должен оставить байты нетронутыми.
    const empty = createNewTrip({ name: 'Пустая', baseCurrency: 'RUB' })
    empty.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(empty))
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(completedTripState()))
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    const activeBefore = localStorage.getItem(STORAGE_KEY)
    const archiveBefore = localStorage.getItem(ARCHIVE_STORAGE_KEY)

    expect(t.finishTrip()).toEqual({ ok: false, reason: 'nothing-to-archive' })

    expect(t.trip.value?.name).toBe('Пустая')
    expect(t.trip.value?.status).toBe('active')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(activeBefore)
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBe(archiveBefore)
    expect(t.archivedTrip.value?.name).toBe('Прошлая')
  })

  it('без поездки — отказ no-trip', async () => {
    const { useTrip } = await loadUseTrip()
    const t = useTrip()

    expect(t.finishTrip()).toEqual({ ok: false, reason: 'no-trip' })
  })
})

describe('deleteTrip: аварийный выход', () => {
  it('чистит активный ключ, архивный не трогает — байты прежние', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(createNewTrip({ name: 'Ошибочная', baseCurrency: 'RUB' })),
    )
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(completedTripState()))
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    const archiveBefore = localStorage.getItem(ARCHIVE_STORAGE_KEY)
    expect(t.trip.value?.name).toBe('Ошибочная')
    expect(t.archivedTrip.value?.name).toBe('Прошлая')

    t.deleteTrip()

    expect(t.trip.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBe(archiveBefore)
    expect(t.archivedTrip.value?.name).toBe('Прошлая')
  })

  it('без поездки — тихий no-op без исключений', async () => {
    const { useTrip } = await loadUseTrip()
    const t = useTrip()

    expect(() => t.deleteTrip()).not.toThrow()
    expect(t.trip.value).toBeNull()
  })
})

describe('createTrip и архив', () => {
  it('успешное создание затирает занятый архив (ADR 0002)', async () => {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(completedTripState()))
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    expect(t.archivedTrip.value?.name).toBe('Прошлая')

    expect(t.createTrip({ name: 'Новая', baseCurrency: 'RUB' })).toEqual({ ok: true })

    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
    expect(t.archivedTrip.value).toBeNull()
  })

  it('отказ (пустое имя) архив не трогает', async () => {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(completedTripState()))
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    const archiveBefore = localStorage.getItem(ARCHIVE_STORAGE_KEY)

    expect(t.createTrip({ name: '   ', baseCurrency: 'RUB' })).toEqual({
      ok: false,
      reason: 'empty-name',
    })

    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBe(archiveBefore)
    expect(t.archivedTrip.value?.name).toBe('Прошлая')
  })
})

describe('загрузка архива при старте', () => {
  it('перезагрузка страницы восстанавливает архивную поездку', async () => {
    const { t, anya, borya } = await loadTripWithParticipants()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })
    if (!added.ok) throw new Error('расход не добавился')
    expect(t.finishTrip()).toEqual({ ok: true })

    vi.resetModules()
    const { useTrip } = await loadUseTrip()
    const reloaded = useTrip()

    expect(reloaded.trip.value).toBeNull()
    expect(reloaded.archivedTrip.value?.name).toBe('Кипр')
    expect(reloaded.archivedTrip.value?.status).toBe('completed')
    expect(reloaded.archivedTrip.value?.expenses).toHaveLength(1)
    expect(reloaded.archiveLoadError.value).toBeNull()
  })

  it('повреждённый архив — ошибка damaged, активная поездка грузится нормально', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })),
    )
    localStorage.setItem(ARCHIVE_STORAGE_KEY, 'мусор')

    const { useTrip } = await loadUseTrip()
    const t = useTrip()

    expect(t.trip.value?.name).toBe('Кипр')
    expect(t.loadError.value).toBeNull()
    expect(t.archivedTrip.value).toBeNull()
    expect(t.archiveLoadError.value?.kind).toBe('damaged')
  })

  it('discardCorruptedArchive чистит ключ и ошибку', async () => {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, '{это не json')
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    expect(t.archiveLoadError.value?.kind).toBe('damaged')

    t.discardCorruptedArchive()

    expect(t.archiveLoadError.value).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
  })
})

describe('гонка завершения/удаления с дебаунсом автосейва', () => {
  it('запланированный автосейв не воскрешает активный ключ после finishTrip', async () => {
    const { t, anya, borya } = await loadTripWithParticipants()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })
    if (!added.ok) throw new Error('расход не добавился')
    await flushWatchers() // автосейв запланирован, но ещё не записан
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    expect(t.finishTrip()).toEqual({ ok: true })
    await flushWatchers() // вотчер перепланировал таймер уже на null-поездку
    vi.advanceTimersByTime(500)

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).not.toBeNull()
  })

  it('то же для deleteTrip — активный ключ не воскресает', async () => {
    const { t, anya, borya } = await loadTripWithParticipants()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })
    if (!added.ok) throw new Error('расход не добавился')
    await flushWatchers()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    t.deleteTrip()
    await flushWatchers()
    vi.advanceTimersByTime(500)

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
  })
})
