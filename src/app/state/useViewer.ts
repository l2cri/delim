import { computed } from 'vue'
import type { Ref } from 'vue'
import { decodeTripState } from '../../core'
import type { DecodeResult, TripDecodeError, TripState } from '../../core'
import { useHashRoute } from './useHashRoute'

/**
 * Зрительский стейт (#/t=…): полезная нагрузка хэша → декод ядра → поездка
 * или типизированная причина отказа (тикет 15). Не касается localStorage
 * и useTrip: открытие ссылки не трогает локальную поездку организатора.
 * Декод чистый и ленивый — пересчитывается только при смене полезной нагрузки.
 */
export function useViewer(): {
  viewerTrip: Readonly<Ref<TripState | null>>
  viewerError: Readonly<Ref<TripDecodeError | null>>
} {
  const { route } = useHashRoute()

  // Единственное место декода: computed кэшируется, viewerTrip и viewerError
  // читают один результат на полезную нагрузку, а не декодируют дважды.
  const decoded = computed<DecodeResult | null>(() => {
    const current = route.value
    return current.name === 'viewer' ? decodeTripState(current.payload) : null
  })

  const viewerTrip = computed<TripState | null>(() => {
    const result = decoded.value
    return result?.ok ? result.state : null
  })

  const viewerError = computed<TripDecodeError | null>(() => {
    const result = decoded.value
    return result && !result.ok ? result.error : null
  })

  return { viewerTrip, viewerError }
}
