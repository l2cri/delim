<script setup lang="ts">
import type { Currency, Expense, Participant } from '../../core'
import { TRIP_LIMITS, convertToBase } from '../../core'
import type { ExpenseInput } from '../state/useTrip'
import { formatMinor } from './format'
import ExpenseForm from './ExpenseForm.vue'

// Секция «Расходы» в стиле «Участников»: список с анимацией и формой вместо
// кнопки добавления. Состояние «что открыто» владельцем живёт в TripScreen —
// сюда приходят только данные и уходят только намерения пользователя.

/** Что открыто в секции: добавление, редактирование конкретного расхода или ничего. */
export type ExpenseEditor = { kind: 'add' } | { kind: 'edit'; expense: Expense }

const props = withDefaults(
  defineProps<{
    participants: Participant[]
    expenses: Expense[]
    currencies: Currency[]
    baseCurrency: string
    editing: ExpenseEditor | null
    /** Режим зрителя (тикет 15): только список, без кнопок и форм — экран не меняется. */
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  /** Клик «+ Добавить расход». */
  open: []
  edit: [expense: Expense]
  remove: [expense: Expense]
  save: [input: ExpenseInput]
  cancel: []
}>()

const limit = TRIP_LIMITS.expenses

// Плательщик неудалим из поездки, пока фигурирует в расходе; на всякий случай
// чужого/пропавшего референса показываем нейтральную квитанцию вместо падения.
function payerOf(expense: Expense): Participant | undefined {
  return props.participants.find((p) => p.id === expense.payerId)
}

/** Эквивалент суммы в базовой валюте по текущему курсу; null — валюта и есть базовая. */
function baseEquivalent(expense: Expense): string | null {
  if (expense.currencyCode === props.baseCurrency) return null
  const rate = props.currencies.find((c) => c.code === expense.currencyCode)?.rate
  if (!rate) return null
  return `≈ ${formatMinor(convertToBase(expense.amount, rate))} ${props.baseCurrency}`
}
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="expenses-heading"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="expenses-heading" class="font-medium">Расходы</h2>
      <span class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        {{ expenses.length }} из {{ limit }}
      </span>
    </div>

    <!-- Зрителю без участников подсказка не нужна: он никого не добавит. -->
    <p v-if="participants.length === 0 && !readonly" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы вносить расходы
    </p>

    <template v-else>
      <template v-if="!readonly">
        <ExpenseForm
          v-if="editing"
          :key="editing.kind === 'edit' ? editing.expense.id : 'add'"
          :participants="participants"
          :currencies="currencies"
          :base-currency="baseCurrency"
          :editing="editing.kind === 'edit' ? editing.expense : null"
          @save="(input) => emit('save', input)"
          @cancel="emit('cancel')"
        />
        <button
          v-else
          type="button"
          class="w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-emerald-500 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
          @click="emit('open')"
        >
          + Добавить расход
        </button>
      </template>

      <p v-if="expenses.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
        <template v-if="readonly">Расходов пока нет</template>
        <template v-else>Пока расходов нет. Добавьте первый — например, такси или ужин.</template>
      </p>

      <TransitionGroup
        v-else
        tag="ul"
        name="expense"
        class="space-y-2"
        aria-label="Список расходов"
      >
        <li
          v-for="expense in expenses"
          :key="expense.id"
          class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
            :style="payerOf(expense) ? { backgroundColor: payerOf(expense)!.color + '33' } : undefined"
            >{{ payerOf(expense)?.emoji ?? '🧾' }}</span
          >

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ expense.title }}</p>
            <p class="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {{ payerOf(expense)?.name ?? 'Плательщик неизвестен' }}
            </p>
          </div>

          <div class="shrink-0 text-right">
            <p class="text-sm font-medium tabular-nums">
              {{ formatMinor(expense.amount) }} {{ expense.currencyCode }}
            </p>
            <p
              v-if="baseEquivalent(expense)"
              class="text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
            >
              {{ baseEquivalent(expense) }}
            </p>
          </div>

          <template v-if="!readonly">
            <button
              type="button"
              class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              :aria-label="`Изменить расход ${expense.title}`"
              title="Изменить"
              @click="emit('edit', expense)"
            >
              ✏️
            </button>
            <button
              type="button"
              class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              :aria-label="`Удалить расход ${expense.title}`"
              title="Удалить"
              @click="emit('remove', expense)"
            >
              🗑️
            </button>
          </template>
        </li>
      </TransitionGroup>
    </template>
  </section>
</template>

<style scoped>
/* Появление/уход расхода — та же анимация, что у участников (правило: Vue-переходы). */
.expense-enter-active,
.expense-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.expense-enter-from,
.expense-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
