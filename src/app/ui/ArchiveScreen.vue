<script setup lang="ts">
import { computed } from 'vue'
import { useTrip } from '../state/useTrip'
import { useHashRoute } from '../state/useHashRoute'
import DebtGraphCard from './DebtGraphCard.vue'
import ExpensesCard from './ExpensesCard.vue'
import PaymentsCard from './PaymentsCard.vue'
import ReceiptCard from './ReceiptCard.vue'
import SettlementCard from './SettlementCard.vue'

// Экран архива #/archive (ADR 0002): последняя завершённая поездка, только
// чтение. Итоговые секции — те же, что на активной (участники, расходы, выплаты,
// сведение, граф, квитанция «под рукой» после завершения); валюты и курсы —
// настройки живой поездки, в архиве их нет. Ни одной мутации: стейта архивной
// поездки просто не существует. Ошибка чтения архивного ключа не задевает
// активную поездку — свой экран разбора с решением «удалить архив»
// (образец — LoadErrorScreen).

const { archivedTrip, archiveLoadError, discardCorruptedArchive } = useTrip()
const { navigate } = useHashRoute()

const errorTitle = computed(() =>
  archiveLoadError.value?.kind === 'version'
    ? 'Архив создан другой версией приложения'
    : 'Архивная поездка повреждена',
)

const errorDetail = computed(() =>
  archiveLoadError.value?.kind === 'damaged'
    ? `Причина: ${archiveLoadError.value.detail}`
    : undefined,
)
</script>

<template>
  <div
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <main
      v-if="archiveLoadError"
      class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-10 text-center"
    >
      <span class="text-4xl" aria-hidden="true">🧩</span>
      <h2 class="text-xl font-bold tracking-tight">{{ errorTitle }}</h2>
      <p class="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Архив не удалось прочитать из памяти устройства. Активная поездка не затронута —
        повреждён только архивный ключ.
      </p>
      <p v-if="errorDetail" class="max-w-sm text-xs text-zinc-400 dark:text-zinc-600">
        {{ errorDetail }}
      </p>
      <button
        type="button"
        class="mt-2 rounded-xl bg-red-600 px-6 py-3 font-medium text-white"
        @click="discardCorruptedArchive"
      >
        Удалить архив
      </button>
    </main>

    <main
      v-else-if="archivedTrip === null"
      class="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-5 py-10 text-center"
    >
      <span class="text-4xl" aria-hidden="true">🗄️</span>
      <h2 class="text-xl font-bold tracking-tight">Архив пуст</h2>
      <p class="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Завершённая поездка хранится здесь, пока не начнёте следующую.
      </p>
      <button
        type="button"
        class="mt-2 rounded-xl bg-emerald-600 px-6 py-3 font-medium text-white"
        @click="navigate({ name: 'home' })"
      >
        Назад
      </button>
    </main>

    <template v-else>
      <header
        class="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 px-5 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
      >
        <div class="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <button
              type="button"
              class="shrink-0 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label="Назад, на главный экран"
              @click="navigate({ name: 'home' })"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                aria-hidden="true"
              >
                <path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <svg viewBox="0 0 24 24" class="size-7 text-emerald-600" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.5" />
              <path d="M12 5.5 A 6 6 0 0 0 12 18.5 Z" fill="currentColor" />
            </svg>
            <div class="min-w-0">
              <h1 class="truncate text-lg leading-tight font-semibold">{{ archivedTrip.name }}</h1>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                Базовая валюта: {{ archivedTrip.baseCurrency }}
              </p>
            </div>
          </div>
          <!-- Нейтральный чип вместо emerald «Активна»: статус виден с первого взгляда. -->
          <span
            class="shrink-0 rounded-full bg-zinc-500/10 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300"
          >
            Архив · только чтение
          </span>
        </div>
      </header>

      <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-6">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          Поездка завершена — данные доступны только для чтения.
        </p>

        <section
          class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          aria-labelledby="archive-participants-heading"
        >
          <h2 id="archive-participants-heading" class="font-medium">Участники</h2>

          <p
            v-if="archivedTrip.participants.length === 0"
            class="text-sm text-zinc-500 dark:text-zinc-400"
          >
            Участников не было
          </p>

          <!-- Разметка строк — как в TripScreen, но без кнопок и формы: менять некого. -->
          <ul v-else class="space-y-2" aria-label="Список участников">
            <li
              v-for="participant in archivedTrip.participants"
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
          :participants="archivedTrip.participants"
          :expenses="archivedTrip.expenses"
          :currencies="archivedTrip.currencies"
          :base-currency="archivedTrip.baseCurrency"
          :editing="null"
          readonly
        />

        <PaymentsCard
          :participants="archivedTrip.participants"
          :payments="archivedTrip.payments"
          :base-currency="archivedTrip.baseCurrency"
          :editing="null"
          readonly
        />

        <SettlementCard :trip="archivedTrip" />

        <DebtGraphCard :trip="archivedTrip" />

        <ReceiptCard :trip="archivedTrip" />
      </main>

      <footer class="px-5 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
        Работает офлайн · данные хранятся только на устройстве
      </footer>
    </template>
  </div>
</template>
