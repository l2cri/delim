import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewTrip, encodeTripState } from '../../core'
import type { TripState } from '../../core'
import { STORAGE_KEY } from './storage'

/** Слив микрозадач: даёт отработать слушателям hashchange и кэшу computed. */
async function flushWatchers(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Свежий синглтон на тест: сброс реестра модулей + динамический импорт. */
async function loadViewerModule() {
  return await import('./useViewer')
}

/** Байтовая копия поездки организатора в localStorage: зрительская ссылка
 *  обязана оставить её нетронутой — ключевое требование тикета 15. */
let organizerStored: string

/** Поездка для ссылки: два участника и расход поровну — декод не тривиален. */
function tripForLink(name: string): TripState {
  const state = createNewTrip({ name, baseCurrency: 'RUB' })
  state.participants.push(
    { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
    { id: 'p2', name: 'Боря', color: '#0ea5e9', emoji: '🦊' },
  )
  state.expenses.push({
    id: 'e1',
    title: 'Ужин',
    payerId: 'p1',
    amount: 3000,
    currencyCode: 'RUB',
    createdAt: '2026-10-01T10:00:00.000Z',
    split: { mode: 'equal', participantIds: ['p1', 'p2'] },
  })
  return state
}

beforeEach(() => {
  vi.resetModules()
  window.location.hash = ''
  organizerStored = JSON.stringify(createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' }))
  localStorage.setItem(STORAGE_KEY, organizerStored)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useViewer: декод ссылки', () => {
  it('валидная ссылка — зрительская поездка целиком, без ошибки', async () => {
    const state = tripForLink('Сочи')
    window.location.hash = '#/t=' + encodeTripState(state)
    const { useViewer } = await loadViewerModule()
    const { viewerTrip, viewerError } = useViewer()

    expect(viewerTrip.value).toEqual(state)
    expect(viewerError.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(organizerStored)
  })

  it('битая ссылка — поездки нет, типизированная причина damaged', async () => {
    window.location.hash = '#/t=broken'
    const { useViewer } = await loadViewerModule()
    const { viewerTrip, viewerError } = useViewer()

    expect(viewerTrip.value).toBeNull()
    expect(viewerError.value?.kind).toBe('damaged')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(organizerStored)
  })

  it('пустая полезная нагрузка — причина damaged', async () => {
    window.location.hash = '#/t='
    const { useViewer } = await loadViewerModule()
    const { viewerTrip, viewerError } = useViewer()

    expect(viewerTrip.value).toBeNull()
    expect(viewerError.value?.kind).toBe('damaged')
  })

  it('хэш не-зрителя — оба null, декода нет', async () => {
    window.location.hash = '#/'
    const { useViewer } = await loadViewerModule()
    const { viewerTrip, viewerError } = useViewer()

    expect(viewerTrip.value).toBeNull()
    expect(viewerError.value).toBeNull()
  })

  it('смена полезной нагрузки пересчитывает зрительскую поездку', async () => {
    const first = tripForLink('Сочи')
    window.location.hash = '#/t=' + encodeTripState(first)
    const { useViewer } = await loadViewerModule()
    const { viewerTrip } = useViewer()
    expect(viewerTrip.value).toEqual(first)

    const second = tripForLink('Казань')
    window.location.hash = '#/t=' + encodeTripState(second)
    window.dispatchEvent(new Event('hashchange'))
    await flushWatchers()

    expect(viewerTrip.value).toEqual(second)
  })
})
