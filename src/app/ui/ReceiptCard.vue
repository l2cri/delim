<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { TripState } from '../../core'
import { writeToClipboard } from './clipboard'
import { buildReceipt } from './receipt'

// Секция «Квитанция» — шеринг поездки текстом (тикет 14): предпросмотр того,
// что уйдёт в мессенджер, и копирование в буфер одним тапом. Только текст —
// PNG и Web Share запрещены спекой. Компонент ничего не считает: квитанцию
// собирает buildReceipt поверх операций ядра, здесь — буфер обмена и отклик.

const props = defineProps<{
  /** Весь стейт поездки: квитанция производна от участников, расходов, выплат и курсов. */
  trip: TripState
}>()

/** Честный предпросмотр: весь текст, включая бэктики фенс-блока. */
const receipt = computed(() => buildReceipt(props.trip))

/** Успешное копирование: кнопка на ~2 секунды говорит «Скопировано ✓». */
const copied = ref(false)
/** Оба пути копирования провалились — текст можно забрать из предпросмотра руками. */
const failed = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

async function copyReceipt(): Promise<void> {
  const ok = await writeToClipboard(receipt.value)
  failed.value = !ok
  copied.value = ok
  if (ok) {
    if (resetTimer) clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
      resetTimer = null
    }, 2000)
  }
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="receipt-heading"
  >
    <h2 id="receipt-heading" class="font-medium">Квитанция</h2>

    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      Текстовая сводка для мессенджера — скопируйте и отправьте компании.
    </p>

    <pre
      class="max-h-72 overflow-y-auto rounded-xl border border-zinc-100 bg-zinc-50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300"
      >{{ receipt }}</pre
    >

    <button
      type="button"
      class="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white"
      aria-live="polite"
      @click="copyReceipt"
    >
      {{ copied ? 'Скопировано ✓' : 'Скопировать квитанцию' }}
    </button>

    <p v-if="failed" role="status" class="text-sm text-red-600 dark:text-red-400">
      Не удалось скопировать — скопируйте текст предпросмотра вручную
    </p>
  </section>
</template>
