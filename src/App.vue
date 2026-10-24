<script setup lang="ts">
import { useHashRoute } from './app/state/useHashRoute'
import { useTrip } from './app/state/useTrip'
import { useViewer } from './app/state/useViewer'
import CreateTripScreen from './app/ui/CreateTripScreen.vue'
import LoadErrorScreen from './app/ui/LoadErrorScreen.vue'
import ShareErrorScreen from './app/ui/ShareErrorScreen.vue'
import TripScreen from './app/ui/TripScreen.vue'
import ViewerScreen from './app/ui/ViewerScreen.vue'

// Корневая развёртка экранов. Маршрут зрителя (#/t=…) сильнее локальных данных
// (тикет 15): ссылка декодируется из хэша и не зависит ни от localStorage, ни
// от своей поездки — открытие ссылки не трогает данные организатора. Дальше как
// раньше: повреждённые данные → ошибка; поездки нет → создание; иначе — экран
// поездки. Архив (#/archive) подвязывается в 16.
const { route } = useHashRoute()
const { viewerTrip, viewerError } = useViewer()
const { trip, loadError } = useTrip()
</script>

<template>
  <ShareErrorScreen v-if="route.name === 'viewer' && viewerError" :error="viewerError" />
  <ViewerScreen v-else-if="route.name === 'viewer' && viewerTrip" :trip="viewerTrip" />
  <LoadErrorScreen v-else-if="loadError" />
  <CreateTripScreen v-else-if="!trip" />
  <TripScreen v-else />
</template>
