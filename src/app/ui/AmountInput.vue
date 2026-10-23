<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { evalExpr } from '../../core'
import { formatMinor, formatMinorPlain } from './format'

const props = defineProps<{
  /** Сумма в минорных единицах; null — пусто или некорректно. */
  modelValue: number | null
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

// id, aria-label и прочие атрибуты должны попадать на сам <input>, а не на обёртку
// с предпросмотром, поэтому наследование attrs отключено и $attrs вешается вручную.
defineOptions({ inheritAttrs: false })

// Черновик — строка, которую видит и правит пользователь; модель хранит минорные
// единицы. Единственный судья корректности черновика — парсер ядра.
const draft = ref('')

const parsed = computed(() => evalExpr(draft.value))

// Пустой/пробельный черновик — не ошибка, подсветки нет; некорректный непустой —
// тихая красная подсветка без текста ошибки (решение спеки).
const invalid = computed(() => draft.value.trim() !== '' && !parsed.value.ok)

const preview = computed(() =>
  parsed.value.ok ? `→ ${formatMinor(parsed.value.minor)}` : '',
)

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  // Наружу уходит только результат ядра: число в минорных единицах либо null.
  const result = evalExpr(draft.value)
  emit('update:modelValue', result.ok ? result.minor : null)
}

// Синхронизация извне: пришло число, которого черновик не даёт, — набрать его
// в поле (без группировки разрядов, чтобы evalExpr читал черновик обратно и не
// было ложной подсветки); пришёл null при осмысленном черновике (сброс формы
// снаружи) — очистить. Некорректный черновик на середине ввода не затирать.
watch(
  () => props.modelValue,
  (value) => {
    const current = evalExpr(draft.value)
    if (value === null) {
      if (current.ok) draft.value = ''
    } else if (!(current.ok && current.minor === value)) {
      draft.value = formatMinorPlain(value)
    }
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <input
      v-bind="$attrs"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :value="draft"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid ? 'true' : undefined"
      class="w-full rounded-xl border bg-white px-4 py-3 text-base tabular-nums text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      :class="
        invalid
          ? 'border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30'
          : 'border-zinc-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800'
      "
      @input="onInput"
    />
    <p aria-live="polite" class="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{{ preview }}</p>
  </div>
</template>
