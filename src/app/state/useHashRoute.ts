import { ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Хэш-роутинг без vue-router (спека: `#/` активная поездка/создание, `#/archive`
 * архив, `#/t=…` зритель). Хэш выбран под GitHub Pages и шеринг: ссылка поездки —
 * обычный URL приложения. Синглтон на уровне модуля, как и useTrip.
 */

export type Route =
  | { name: 'home' }
  | { name: 'archive' }
  | { name: 'viewer'; payload: string }

// Литералы хэшей — по одному месту на маршрут: разбор и сборка читают константы,
// а не дублируют строки (рассинхрон стал бы битой навигацией).
const HOME_HASH = '#/'
const ARCHIVE_HASH = '#/archive'
const VIEWER_PREFIX = '#/t='

/**
 * Разбор хэша в маршрут. Неизвестный хэш — home: приложение не падает на
 * устаревшей или битой ссылке, а показывает главный экран.
 */
export function parseHash(hash: string): Route {
  if (hash === ARCHIVE_HASH) return { name: 'archive' }
  if (hash.startsWith(VIEWER_PREFIX)) {
    return { name: 'viewer', payload: hash.slice(VIEWER_PREFIX.length) }
  }
  return { name: 'home' }
}

const route = ref<Route>(parseHash(window.location.hash))

window.addEventListener('hashchange', () => {
  route.value = parseHash(window.location.hash)
})

function navigate(next: Route): void {
  if (next.name === 'archive') {
    window.location.hash = ARCHIVE_HASH
  } else if (next.name === 'viewer') {
    window.location.hash = VIEWER_PREFIX + next.payload
  } else {
    window.location.hash = HOME_HASH
  }
}

export function useHashRoute(): {
  route: Readonly<Ref<Route>>
  navigate(next: Route): void
} {
  return { route, navigate }
}
