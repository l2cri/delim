<script setup lang="ts">
import { useTrip } from './app/state/useTrip'
import { useHashRoute } from './app/state/useHashRoute'
import ArchiveScreen from './app/ui/ArchiveScreen.vue'
import CreateTripScreen from './app/ui/CreateTripScreen.vue'
import LoadErrorScreen from './app/ui/LoadErrorScreen.vue'
import TripScreen from './app/ui/TripScreen.vue'

// Корневая развёртка экранов: данные повреждены → ошибка; поездки нет → создание;
// иначе — экран поездки. Архив (#/archive) подключён здесь; зритель (#/t=…) —
// тикет 15, до него любой маршрут с существующей поездкой показывает её экран.
// Экран создания/поездки смонтирован всегда, а при заходе в архив лишь скрыт
// (v-show): черновики и уведомления экрана переживают уход в архив и назад —
// это свойство существующего кода, сохраняем без пересборки.
const { trip, loadError } = useTrip()
const { route } = useHashRoute()
</script>

<template>
  <LoadErrorScreen v-if="loadError" />
  <template v-else>
    <ArchiveScreen v-if="route.name === 'archive'" />
    <CreateTripScreen v-if="!trip" v-show="route.name !== 'archive'" />
    <TripScreen v-if="trip" v-show="route.name !== 'archive'" />
  </template>
</template>
