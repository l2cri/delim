<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Participant, Payment } from '../../core'
import { TRIP_LIMITS } from '../../core'
import type { PaymentInput } from '../state/useTrip'
import { formatMinor } from './format'
import PaymentForm from './PaymentForm.vue'

// Секция «Выплаты» — структурный близнец «Расходов» (тикет 12, ADR 0010):
// зарегистрированные возвраты «кто→кому сколько» списком с анимацией и формой
// вместо кнопки добавления. Состояние «что открыто» владельцем живёт в
// TripScreen — сюда приходят только данные и уходят только намерения пользователя.
// readonly — для экрана архива: список без форм и кнопок, тексты констатируют
// прошедшее («не было»), а не ведут к действию.

/** Что открыто в секции: добавление, редактирование конкретной выплаты или ничего. */
export type PaymentEditor = { kind: 'add' } | { kind: 'edit'; payment: Payment }

const props = defineProps<{
  participants: Participant[]
  payments: Payment[]
  baseCurrency: string
  editing: PaymentEditor | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  /** Клик «+ Добавить выплату». */
  open: []
  edit: [payment: Payment]
  remove: [payment: Payment]
  save: [input: PaymentInput]
  cancel: []
}>()

// Карточка живёт и на активной поездке, и в архиве одновременно (архив лишь
// скрывает экран активной через v-show) — id заголовка уникален на инстанс.
const headingId = useId()

const limit = TRIP_LIMITS.payments

// Счётчик: на активной — с лимитом («5 из 200»), в архиве — просто количество.
const counterLabel = computed(() =>
  props.readonly ? `${props.payments.length}` : `${props.payments.length} из ${limit}`,
)

// Стороны выплаты по id (как transferRows в сведении): упомянутого в выплате
// участника удалить нельзя — на всякий случай чужому/пропавшему референсу
// показываем нейтральные имя и аватар вместо падения.
const byId = computed(() => new Map(props.participants.map((p) => [p.id, p])))

/** Подпись стороны для aria-label кнопок строки: «Боря → Аня». */
function sidesLabel(payment: Payment): string {
  const from = byId.value.get(payment.fromId)
  const to = byId.value.get(payment.toId)
  return `${from?.name ?? '—'} → ${to?.name ?? '—'}`
}
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    :aria-labelledby="headingId"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2 :id="headingId" class="font-medium">Выплаты</h2>
      <span class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        {{ counterLabel }}
      </span>
    </div>

    <p v-if="readonly && payments.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Выплат в этой поездке не было
    </p>
    <p v-else-if="!readonly && participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы фиксировать выплаты
    </p>

    <template v-if="!readonly && participants.length > 0">
      <PaymentForm
        v-if="editing"
        :key="editing.kind === 'edit' ? editing.payment.id : 'add'"
        :participants="participants"
        :base-currency="baseCurrency"
        :editing="editing.kind === 'edit' ? editing.payment : null"
        @save="(input) => emit('save', input)"
        @cancel="emit('cancel')"
      />
      <button
        v-else
        type="button"
        class="w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-emerald-500 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
        @click="emit('open')"
      >
        + Добавить выплату
      </button>

      <p v-if="payments.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
        Пока выплат нет. Когда кто-то рассчитается, зафиксируйте выплату здесь.
      </p>
    </template>

    <TransitionGroup
      v-if="payments.length > 0"
      tag="ul"
      name="payment"
      class="space-y-2"
      aria-label="Список выплат"
    >
      <li
        v-for="payment in payments"
        :key="payment.id"
        class="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
      >
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
          :style="
            byId.get(payment.fromId)
              ? { backgroundColor: byId.get(payment.fromId)!.color + '33' }
              : undefined
          "
          >{{ byId.get(payment.fromId)?.emoji ?? '❓' }}</span
        >
        <span class="shrink-0 text-sm font-medium">{{
          byId.get(payment.fromId)?.name ?? '—'
        }}</span>
        <span class="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true">→</span>
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
          :style="
            byId.get(payment.toId)
              ? { backgroundColor: byId.get(payment.toId)!.color + '33' }
              : undefined
          "
          >{{ byId.get(payment.toId)?.emoji ?? '❓' }}</span
        >
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{
          byId.get(payment.toId)?.name ?? '—'
        }}</span>
        <span class="shrink-0 text-sm font-medium tabular-nums">
          {{ formatMinor(payment.amount) }} {{ baseCurrency }}
        </span>

        <button
          v-if="!readonly"
          type="button"
          class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          :aria-label="`Изменить выплату ${sidesLabel(payment)}`"
          title="Изменить"
          @click="emit('edit', payment)"
        >
          ✏️
        </button>
        <button
          v-if="!readonly"
          type="button"
          class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
          :aria-label="`Удалить выплату ${sidesLabel(payment)}`"
          title="Удалить"
          @click="emit('remove', payment)"
        >
          🗑️
        </button>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
/* Появление/уход выплаты — та же анимация, что у участников и расходов
   (правило: Vue-переходы). */
.payment-enter-active,
.payment-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.payment-enter-from,
.payment-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
