import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Слив микрозадач: даёт отработать слушателям и watch-колбэкам Vue. */
async function flushWatchers(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Свежий синглтон на тест: сброс реестра модулей + динамический импорт. */
async function loadRouteModule() {
  return await import('./useHashRoute')
}

beforeEach(() => {
  vi.resetModules()
  window.location.hash = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseHash: разбор маршрута', () => {
  it('пустой хэш, «#» и «#/» — главный маршрут', async () => {
    const { parseHash } = await loadRouteModule()

    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })

  it('«#/archive» — архив', async () => {
    const { parseHash } = await loadRouteModule()

    expect(parseHash('#/archive')).toEqual({ name: 'archive' })
  })

  it('«#/t=<payload>» — зритель с полезной нагрузкой как есть', async () => {
    const { parseHash } = await loadRouteModule()

    expect(parseHash('#/t=JIFgCg')).toEqual({ name: 'viewer', payload: 'JIFgCg' })
    expect(parseHash('#/t=')).toEqual({ name: 'viewer', payload: '' })
  })

  it('всё прочее — главный маршрут', async () => {
    const { parseHash } = await loadRouteModule()

    expect(parseHash('#archive')).toEqual({ name: 'home' })
    expect(parseHash('#/unknown')).toEqual({ name: 'home' })
  })
})

describe('useHashRoute', () => {
  it('стартовый маршрут берётся из текущего хэша', async () => {
    window.location.hash = '#/archive'
    const { useHashRoute } = await loadRouteModule()

    expect(useHashRoute().route.value).toEqual({ name: 'archive' })
  })

  it('hashchange обновляет маршрут', async () => {
    const { useHashRoute } = await loadRouteModule()
    const { route } = useHashRoute()

    window.location.hash = '#/t=XYZ'
    window.dispatchEvent(new Event('hashchange'))
    await flushWatchers()

    expect(route.value).toEqual({ name: 'viewer', payload: 'XYZ' })
  })

  it('navigate пишет хэш, соответствующий маршруту', async () => {
    const { useHashRoute } = await loadRouteModule()
    const { navigate } = useHashRoute()

    navigate({ name: 'viewer', payload: 'X' })
    expect(window.location.hash).toBe('#/t=X')

    navigate({ name: 'archive' })
    expect(window.location.hash).toBe('#/archive')

    navigate({ name: 'home' })
    expect(window.location.hash).toBe('#/')
  })
})
