<script setup lang="ts">
import type { TripState } from '../../core'
import { TRIP_LIMITS } from '../../core'
import CurrenciesCard from './CurrenciesCard.vue'
import DebtGraphCard from './DebtGraphCard.vue'
import ExpensesCard from './ExpensesCard.vue'
import PaymentsCard from './PaymentsCard.vue'
import ReceiptCard from './ReceiptCard.vue'
import SettlementCard from './SettlementCard.vue'

// Экран зрителя (тикет 15): та же поездка по ссылке-приглашению `#/t=…`, только
// чтение. Структура и визуальный язык — TripScreen; все управляющие элементы
// заменены readonly-режимами карточек. Компонент ничего не считает и не мутирует:
// стейт приходит готовым (декодированным из ссылки), здесь — только показ.
// Кнопки «Поделиться» нет: зритель не распространяет чужую ссылку дальше.

// Стейт приходит пропсом и читается шаблоном напрямую; в script setup он не нужен.
defineProps<{
  /** Стейт поездки из ссылки: декодирован до входа на экран, здесь только читается. */
  trip: TripState
}>()

const limit = TRIP_LIMITS.participants
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <header
      class="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 px-5 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      <div class="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <svg viewBox="0 0 24 24" class="size-7 shrink-0 text-emerald-600" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.5" />
            <path d="M12 5.5 A 6 6 0 0 0 12 18.5 Z" fill="currentColor" />
          </svg>
          <div class="min-w-0">
            <h1 class="truncate text-lg leading-tight font-semibold">{{ trip.name }}</h1>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              Базовая валюта: {{ trip.baseCurrency }}
            </p>
          </div>
        </div>
        <!-- Бейдж — главный носитель режима: заметен и без строки-пояснения ниже. -->
        <span
          class="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400"
          aria-label="Режим зрителя"
        >
          Только чтение
        </span>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-6">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        Поездка открыта по ссылке-приглашению — смотрите, но не редактируйте
      </p>

      <section
        class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        aria-labelledby="participants-heading"
      >
        <div class="flex items-baseline justify-between gap-3">
          <h2 id="participants-heading" class="font-medium">Участники</h2>
          <span class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {{ trip.participants.length }} из {{ limit }}
          </span>
        </div>

        <p v-if="trip.participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
          Участников нет
        </p>

        <ul v-else class="space-y-2" aria-label="Список участников">
          <li
            v-for="participant in trip.participants"
            :key="participant.id"
            class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
              :style="{ backgroundColor: participant.color + '33' }"
              >{{ participant.emoji }}</span
            >
            <span class="min-w-0 flex-1 truncate">{{ participant.name }}</span>
          </li>
        </ul>
      </section>

      <ExpensesCard
        :participants="trip.participants"
        :expenses="trip.expenses"
        :currencies="trip.currencies"
        :base-currency="trip.baseCurrency"
        :editing="null"
        :readonly="true"
      />

      <CurrenciesCard
        :currencies="trip.currencies"
        :base-currency="trip.baseCurrency"
        :adding="false"
        :readonly="true"
      />

      <PaymentsCard
        :participants="trip.participants"
        :payments="trip.payments"
        :base-currency="trip.baseCurrency"
        :editing="null"
        :readonly="true"
      />

      <SettlementCard :trip="trip" />

      <DebtGraphCard :trip="trip" />

      <!-- Копирование квитанции — чтение: зритель может унести текст с собой. -->
      <ReceiptCard :trip="trip" />
    </main>

    <footer class="px-5 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
      Работает офлайн · данные хранятся только на устройстве
    </footer>
  </div>
</template>
