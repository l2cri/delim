<script setup lang="ts">
import { computed } from 'vue'
import type { Participant, TripState } from '../../core'
import { computeBalances, settle } from '../../core'
import { formatMinor } from './format'

// Секция «Сведение» — итоги поездки из тикета 11: балансы участников и минимальные
// переводы. Сведение — производная величина (ADR 0010): computeBalances → settle
// на каждом изменении стейта, ничего не хранится и не закрывается руками. Компонент
// денег не считает — только вызовы ядра, сортировка для показа и форматирование.

const props = defineProps<{
  /** Весь стейт поездки: балансы производны от расходов, выплат и курсов вместе. */
  trip: TripState
}>()

/** Строка списка балансов: участник, его баланс и место в порядке поездки (тай-брейк). */
interface BalanceRow {
  participant: Participant
  amount: number
  order: number
  /** Человекочитаемый баланс: «должны ему 666,66 RUB» / «должен 333,33 RUB» / «в нуле». */
  label: { text: string; tone: 'credit' | 'debt' | 'zero' }
}

const balances = computed(() => computeBalances(props.trip))

/** Подпись баланса с готовой суммой и тоном цвета: кредит / долг / ноль. */
function describeBalance(amount: number): BalanceRow['label'] {
  const currency = props.trip.baseCurrency
  if (amount > 0) {
    return { text: `должны ему ${formatMinor(amount)} ${currency}`, tone: 'credit' }
  }
  if (amount < 0) {
    return { text: `должен ${formatMinor(-amount)} ${currency}`, tone: 'debt' }
  }
  return { text: 'в нуле', tone: 'zero' }
}

// Порядок показа: по модулю баланса по убыванию, при равенстве — порядок участников
// поездки (тот же тай-брейк, что и в сведении ядра); нулевые — в конце.
const balanceRows = computed<BalanceRow[]>(() => {
  // Стыковка участника с записью баланса — по participantId через Map, как в
  // transferRows ниже: computeBalances даёт запись на каждого участника, поэтому
  // поиск всегда находит (порядок записей ядра здесь не используется).
  const byId = new Map(props.trip.participants.map((p) => [p.id, p]))
  return balances.value
    .map((entry, order) => ({
      participant: byId.get(entry.participantId)!,
      amount: entry.amount,
      order,
      label: describeBalance(entry.amount),
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.order - b.order)
})

const toneClass = {
  credit: 'text-emerald-600 dark:text-emerald-400',
  debt: 'text-red-600 dark:text-red-400',
  zero: 'text-zinc-500 dark:text-zinc-400',
} as const

/** Строка списка переводов: имена сторон (для аватаров и подписи) и сумма. */
interface TransferRow {
  from: Participant | undefined
  to: Participant | undefined
  amount: number
}

const transferRows = computed<TransferRow[]>(() => {
  const byId = new Map(props.trip.participants.map((p) => [p.id, p]))
  // Упомянутого в расчётах участника удалить нельзя (мурации запрещают) — но
  // чужому референсу показываем нейтральное имя вместо падения, как в расходах.
  return settle(balances.value).map((transfer) => ({
    from: byId.get(transfer.fromId),
    to: byId.get(transfer.toId),
    amount: transfer.amount,
  }))
})
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="settlement-heading"
  >
    <h2 id="settlement-heading" class="font-medium">Сведение</h2>

    <p v-if="trip.participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы увидеть балансы
    </p>

    <template v-else>
      <h3 class="text-sm text-zinc-500 dark:text-zinc-400">Балансы</h3>
      <TransitionGroup
        tag="ul"
        name="settle"
        class="space-y-2"
        aria-label="Список балансов"
      >
        <li
          v-for="row in balanceRows"
          :key="row.participant.id"
          class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
            :style="{ backgroundColor: row.participant.color + '33' }"
            >{{ row.participant.emoji }}</span
          >
          <span class="min-w-0 flex-1 truncate">{{ row.participant.name }}</span>
          <span class="shrink-0 text-sm font-medium tabular-nums" :class="toneClass[row.label.tone]">
            {{ row.label.text }}
          </span>
        </li>
      </TransitionGroup>

      <h3 class="text-sm text-zinc-500 dark:text-zinc-400">Минимальные переводы</h3>
      <TransitionGroup
        v-if="transferRows.length > 0"
        tag="ul"
        name="settle"
        class="space-y-2"
        aria-label="Список переводов"
      >
        <li
          v-for="transfer in transferRows"
          :key="`${transfer.from?.id ?? '?'}:${transfer.to?.id ?? '?'}`"
          class="flex items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
            :style="transfer.from ? { backgroundColor: transfer.from.color + '33' } : undefined"
            >{{ transfer.from?.emoji ?? '❓' }}</span
          >
          <span class="shrink-0 text-sm font-medium">{{ transfer.from?.name ?? '—' }}</span>
          <span class="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true">→</span>
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
            :style="transfer.to ? { backgroundColor: transfer.to.color + '33' } : undefined"
            >{{ transfer.to?.emoji ?? '❓' }}</span
          >
          <span class="min-w-0 flex-1 truncate text-sm font-medium">
            {{ transfer.to?.name ?? '—' }}
          </span>
          <span class="shrink-0 text-sm font-medium tabular-nums">
            {{ formatMinor(transfer.amount) }} {{ trip.baseCurrency }}
          </span>
        </li>
      </TransitionGroup>
      <p v-else class="text-sm text-zinc-500 dark:text-zinc-400">
        Переводов нет — все в нуле
      </p>
    </template>
  </section>
</template>

<style scoped>
/* Пересортировка балансов и смена переводов — та же анимация, что у участников
   и расходов (правило: Vue-переходы, без внешних библиотек). */
.settle-enter-active,
.settle-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.settle-enter-from,
.settle-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
