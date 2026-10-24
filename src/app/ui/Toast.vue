<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

// Тост-уведомление экрана поездки (тикет 17): сообщения-отказы и подтверждения
// раньше были абзацем в самом низу разметки — на телефоне за пределами видимости.
// Тост закреплён у нижнего края в зоне видимости: заметен без скролла, весь
// закрывается тапом, автоскрытие, тон (error/warn/info) сохранён за сообщением.

export type ToastNotice = { tone: 'error' | 'warn' | 'info'; text: string }

const props = defineProps<{
  /** null — тост скрыт; каждая смена notice перезапускает таймер автоскрытия. */
  notice: ToastNotice | null
}>()

const emit = defineEmits<{
  /** Тап по тосту — то же намерение, что автоскрытие: сообщение прочитано. */
  dismiss: []
}>()

// ~3–4 с из тикета: короткую фразу дочитывается, надоедать не успевает.
const AUTOHIDE_MS = 4000

// Палитра тонов — карточки и точки поверх любого фона, «белых пятен» в тёмной
// теме нет. info — нейтральная карточка с акцентной точкой приложения.
const TONE_CLASSES = {
  error: {
    card: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/80 dark:text-red-200',
    dot: 'bg-red-500',
  },
  warn: {
    card: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/80 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  info: {
    card: 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
    dot: 'bg-emerald-500',
  },
} as const

// Таймер гасится при каждой смене notice и при размонтировании: взведённый на
// реальных часах таймер иначе переживает тест и срабатывает посреди соседнего
// (см. комментарий про дебаунс в tests/smoke/trip-screens.test.ts).
let hideTimer: ReturnType<typeof setTimeout> | null = null

function armAutohide(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  if (props.notice !== null) {
    hideTimer = setTimeout(() => {
      hideTimer = null
      emit('dismiss')
    }, AUTOHIDE_MS)
  }
}

watch(() => props.notice, armAutohide, { immediate: true })

onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <!-- Обёртка не ловит клики и ничего не сдвигает в потоке страницы; тост
       рисуется поверх контента (z-50, как диалоги: смонтированный позже — выше). -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]"
  >
    <Transition appear name="toast">
      <!-- Роль и aria-live — на обёртку, а не на кнопку: роль на интерактивном
           элементе перекрывает его семантику «кнопка» для скринридера. Тап —
           по всей площади тоста: кнопка растянута на карточку целиком. -->
      <div
        v-if="notice"
        :role="notice.tone === 'info' ? 'status' : 'alert'"
        :aria-live="notice.tone === 'info' ? 'polite' : 'assertive'"
        class="pointer-events-auto w-full max-w-md rounded-2xl border p-4 text-sm shadow-lg"
        :class="TONE_CLASSES[notice.tone].card"
      >
        <button type="button" class="flex w-full items-start gap-3 text-left" @click="emit('dismiss')">
          <span
            class="mt-1.5 size-2 shrink-0 rounded-full"
            :class="TONE_CLASSES[notice.tone].dot"
            aria-hidden="true"
          ></span>
          <span>{{ notice.text }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Появление и уход — тонкое, в стиле приложения: снизу вверх на месте тоста
   (правило: анимации только Vue-переходами). */
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
