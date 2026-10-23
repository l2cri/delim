<script setup lang="ts">
import { useHashRoute } from './app/state/useHashRoute'
import { useTrip } from './app/state/useTrip'
import CreateTripScreen from './app/ui/CreateTripScreen.vue'
import LoadErrorScreen from './app/ui/LoadErrorScreen.vue'
import TripScreen from './app/ui/TripScreen.vue'

// Корневая развёртка экранов: данные повреждены → ошибка; поездки нет → создание;
// иначе — экран поездки. Зритель (#/t=…) и архив (#/archive) подвязываются в 15–16,
// пока любой маршрут с существующей поездкой показывает её экран.
const { route } = useHashRoute()
const { trip, loadError } = useTrip()
</script>

<template>
  <LoadErrorScreen v-if="loadError" />
  <CreateTripScreen v-else-if="!trip" />
  <TripScreen v-else :key="route.name" />
</template>
