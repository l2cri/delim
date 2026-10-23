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

/**
 * Разбор хэша в маршрут. Неизвестный хэш — home: приложение не падает на
 * устаревшей или битой ссылке, а показывает главный экран.
 */
export function parseHash(hash: string): Route {
  if (hash === '#/archive') return { name: 'archive' }
  if (hash.startsWith('#/t=')) {
    return { name: 'viewer', payload: hash.slice('#/t='.length) }
  }
  return { name: 'home' }
}

const route = ref<Route>(parseHash(window.location.hash))

window.addEventListener('hashchange', () => {
  route.value = parseHash(window.location.hash)
})

function navigate(next: Route): void {
  switch (next.name) {
    case 'home':
      window.location.hash = '#/'
      break
    case 'archive':
      window.location.hash = '#/archive'
      break
    case 'viewer':
      window.location.hash = `#/t=${next.payload}`
      break
  }
}

export function useHashRoute(): {
  route: Readonly<Ref<Route>>
  navigate(next: Route): void
} {
  return { route, navigate }
}
