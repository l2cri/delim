<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Participant, Payment } from '../../core'
import type { PaymentInput } from '../state/useTrip'
import AmountInput from './AmountInput.vue'

// Управляемая форма выплаты: внутри — только черновики и их отображение. Выплата
// всегда в базовой валюте поездки (ADR 0010, SPEC) — селекта валюты нет, обозначение
// статично. Никакой бизнес-логики: сумма парсится ядром (AmountInput/evalExpr),
// правила позитивности и «разные стороны» — вопросы к черновикам в canSave.

const props = defineProps<{
  participants: Participant[]
  baseCurrency: string
  /** null — регистрация новой выплаты, объект — редактирование существующей. */
  editing: Payment | null
}>()

const emit = defineEmits<{
  save: [input: PaymentInput]
  cancel: []
}>()

// Префилл: новая выплата — первые два участника (стороны различаются сразу);
// редактирование — поля выплаты. Устаревший референс — нейтральный фолбэк, как
// плательщик в ExpenseForm.
const fromId = ref(props.editing?.fromId ?? props.participants[0]?.id ?? '')
const toId = ref(props.editing?.toId ?? props.participants[1]?.id ?? '')
if (!props.participants.some((p) => p.id === fromId.value)) {
  fromId.value = props.participants[0]?.id ?? ''
}
if (!props.participants.some((p) => p.id === toId.value)) {
  toId.value =
    props.participants.find((p) => p.id !== fromId.value)?.id ?? props.participants[0]?.id ?? ''
}

const amount = ref<number | null>(props.editing?.amount ?? null)

/** Введённая положительная сумма либо null — выплата всегда больше нуля. */
const positiveAmount = computed(() => {
  const value = amount.value
  return value !== null && value > 0 ? value : null
})

const canSave = computed(() => {
  if (positiveAmount.value === null) return false
  if (!props.participants.some((p) => p.id === fromId.value)) return false
  if (!props.participants.some((p) => p.id === toId.value)) return false
  return fromId.value !== toId.value
})

function submit(): void {
  const total = positiveAmount.value
  if (total === null || !canSave.value) return
  emit('save', { fromId: fromId.value, toId: toId.value, amount: total })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <p v-if="participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы фиксировать выплаты
    </p>

    <template v-else>
      <div class="flex gap-2">
        <select
          v-model="fromId"
          aria-label="Кто платит"
          class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option v-for="participant in participants" :key="participant.id" :value="participant.id">
            {{ participant.name }}
          </option>
        </select>
        <select
          v-model="toId"
          aria-label="Кому"
          class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option v-for="participant in participants" :key="participant.id" :value="participant.id">
            {{ participant.name }}
          </option>
        </select>
      </div>

      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <AmountInput
            v-model="amount"
            placeholder="Например, 500"
            aria-label="Сумма выплаты"
          />
        </div>
        <!-- Выплата всегда в базовой валюте поездки (ADR 0010) — статичное обозначение, не select. -->
        <span class="shrink-0 px-1 py-3 text-base tabular-nums text-zinc-500 dark:text-zinc-400">
          {{ baseCurrency }}
        </span>
      </div>
    </template>

    <div class="flex gap-2">
      <button
        type="button"
        class="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
        @click="emit('cancel')"
      >
        Отмена
      </button>
      <button
        type="submit"
        :disabled="!canSave"
        class="flex-1 rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ editing ? 'Сохранить выплату' : 'Добавить выплату' }}
      </button>
    </div>
  </form>
</template>
