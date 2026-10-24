<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

// Единый диалог подтверждения необратимых действий (завершение поездки, удаление,
// замена архива): нативный confirm() не используем — цена действия объясняется
// в визуальном языке приложения, тон кнопки (primary/danger) виден до нажатия.

withDefaults(
  defineProps<{
    title: string
    description: string
    confirmLabel: string
    /** primary — спокойное подтверждение, danger — необратимая потеря данных. */
    tone: 'primary' | 'danger'
    cancelLabel?: string
  }>(),
  { cancelLabel: 'Отмена' },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

// Escape — то же намерение «отмена», что клик по фону и кнопка: слушатель живёт
// на window ровно пока диалог смонтирован, снятие на unmount исключает дублей.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition appear name="confirm">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-5"
      @click.self="emit('cancel')"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        class="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="confirm-dialog-title" class="font-medium">{{ title }}</h2>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{{ description }}</p>
        <div class="space-y-2">
          <button
            type="button"
            class="w-full rounded-xl px-4 py-3 font-medium text-white transition-opacity"
            :class="tone === 'danger' ? 'bg-red-600' : 'bg-emerald-600'"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
          <button
            type="button"
            class="w-full rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Появление — тонкое, в стиле приложения: лёгкий масштаб вместо смещения
   (правило: анимации только Vue-переходами). */
.confirm-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.confirm-enter-from {
  opacity: 0;
  transform: scale(0.97);
}
</style>
