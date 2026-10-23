<script setup lang="ts">
import { computed } from 'vue'
import { useTrip } from '../state/useTrip'

// Состояние ошибки загрузки (правило «никакой пустоты без объяснения»):
// повреждённые или чужие по версии данные не открываются, но приложение живо.
const { loadError, discardCorrupted } = useTrip()

const title = computed(() => {
  if (loadError.value?.kind === 'version') {
    return 'Сохранённая поездка создана другой версией приложения'
  }
  return 'Сохранённая поездка повреждена'
})

const detail = computed(() => {
  if (loadError.value?.kind === 'damaged') {
    return `Причина: ${loadError.value.detail}`
  }
  return undefined
})
</script>

<template>
  <div
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <main class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <span class="text-4xl" aria-hidden="true">🧩</span>
      <h2 class="text-xl font-bold tracking-tight">{{ title }}</h2>
      <p class="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {{
          loadError?.kind === 'version'
            ? 'Данные остались на устройстве, но эта версия приложения их не понимает. Начните новую поездку — старая будет заменена.'
            : 'Поездку не удалось прочитать из памяти устройства. Можно начать новую — повреждённые данные будут стёрты.'
        }}
      </p>
      <p v-if="detail" class="max-w-sm text-xs text-zinc-400 dark:text-zinc-600">{{ detail }}</p>
      <button
        type="button"
        class="mt-2 rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white"
        @click="discardCorrupted"
      >
        Начать новую поездку
      </button>
    </main>
  </div>
</template>
