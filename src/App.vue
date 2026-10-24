<script setup lang="ts">
import { useTrip } from './app/state/useTrip'
import { useHashRoute } from './app/state/useHashRoute'
import { useViewer } from './app/state/useViewer'
import ArchiveScreen from './app/ui/ArchiveScreen.vue'
import CreateTripScreen from './app/ui/CreateTripScreen.vue'
import LoadErrorScreen from './app/ui/LoadErrorScreen.vue'
import ShareErrorScreen from './app/ui/ShareErrorScreen.vue'
import TripScreen from './app/ui/TripScreen.vue'
import ViewerScreen from './app/ui/ViewerScreen.vue'

// Корневая развёртка экранов. Маршрут зрителя (#/t=…) сильнее локальных данных
// (тикет 15): ссылка декодируется из хэша и не зависит ни от localStorage, ни
// от своей поездки — открытие ссылки не трогает данные организатора. Дальше:
// повреждённые данные → ошибка; архив (#/archive) → архив; поездки нет →
// создание; иначе — экран поездки. Экран создания/поездки смонтирован всегда,
// а при заходе в архив лишь скрыт (v-show): черновики и уведомления экрана
// переживают уход в архив и назад — это свойство существующего кода (тикет 16),
// сохраняем без пересборки.
const { trip, loadError } = useTrip()
const { route } = useHashRoute()
const { viewerTrip, viewerError } = useViewer()
</script>

<template>
  <ShareErrorScreen v-if="route.name === 'viewer' && viewerError" :error="viewerError" />
  <ViewerScreen v-else-if="route.name === 'viewer' && viewerTrip" :trip="viewerTrip" />
  <LoadErrorScreen v-else-if="loadError" />
  <template v-else>
    <ArchiveScreen v-if="route.name === 'archive'" />
    <CreateTripScreen v-if="!trip" v-show="route.name !== 'archive'" />
    <TripScreen v-if="trip" v-show="route.name !== 'archive'" />
  </template>
</template>
