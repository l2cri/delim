<script setup lang="ts">
import { computed } from 'vue'
import type { TripDecodeError } from '../../core'
import { useHashRoute } from '../state/useHashRoute'

// Экран «ссылка повреждена» (тикет 15): битый вход `#/t=…` не открывает поездку,
// но приложение живо. Причина — типизированный TripDecodeError ядра; здесь только
// человекочитаемый текст по kind, без догадок и без частичного импорта (SPEC:
// all-or-nothing — форк битой ссылки запрещён). Единственное действие — выход к
// своим данным; это не «продолжить локально»: зрительского стейта не существует.

const props = defineProps<{
  /** Отказ декодера: вид поломки ссылки и её точные параметры. */
  error: TripDecodeError
}>()

const { navigate } = useHashRoute()

/** Текст причины по kind — формулировки согласованы со спеком тикета 15. */
const detail = computed<string>(() => {
  switch (props.error.kind) {
    case 'version':
      return 'Ссылка создана другой версией приложения. Попросите организатора прислать новую ссылку.'
    case 'too-long':
      return `В ссылке ${props.error.actual} символов — это больше лимита в ${props.error.max}. Попросите организатора отправить квитанцию: она короче любой ссылки.`
    case 'limit':
      return `В ссылке больше записей, чем допускает поездка: ${props.error.actual} при максимуме ${props.error.max}. Попросите организатора новую ссылку.`
    case 'references':
      return 'В ссылке упоминается несуществующий участник или валюта — данные исказились при пересылке. Попросите организатора скопировать ссылку заново.'
    case 'damaged':
      return `По ссылке не удалось прочитать поездку: ${props.error.detail}. При пересылке часть символов, похоже, потерялась — попросите организатора скопировать ссылку заново.`
  }
})
</script>

<template>
  <div
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <main
      class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-10 text-center"
    >
      <span class="text-4xl" aria-hidden="true">🔗</span>
      <h2 class="text-xl font-bold tracking-tight">Ссылка повреждена</h2>
      <p class="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        {{ detail }}
      </p>
      <!-- Выход к своим данным, не импорт: зрительская ссылка не сохраняется. -->
      <button
        type="button"
        class="mt-2 rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white"
        @click="navigate({ name: 'home' })"
      >
        Открыть приложение
      </button>
    </main>
  </div>
</template>
