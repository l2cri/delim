<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Expense, Participant, Rational } from '../../core'
import { TRIP_LIMITS } from '../../core'
import { plural } from './format'
import CurrenciesCard from './CurrenciesCard.vue'
import ExpensesCard from './ExpensesCard.vue'
import type { ExpenseEditor } from './ExpensesCard.vue'
import {
  useTrip,
  type AddCurrencyResult,
  type AddParticipantResult,
  type ExpenseInput,
  type RemoveCurrencyResult,
  type RemoveParticipantResult,
  type SaveExpenseResult,
  type UpdateCurrencyRateResult,
} from '../state/useTrip'
import { isBlank } from '../state/validation'

// Экран поездки без бизнес-логики: все правила (лимит, занятость, палитры) —
// в useTrip; здесь только вызовы мутаций и человекочитаемые сообщения об отказах.

const {
  trip,
  addParticipant,
  renameParticipant,
  removeParticipant,
  regenerateAvatar,
  addExpense,
  updateExpense,
  removeExpense,
  addCurrency,
  updateCurrencyRate,
  removeCurrency,
} = useTrip()

const participants = computed(() => trip.value?.participants ?? [])
const limit = TRIP_LIMITS.participants

// Что открыто в секции расходов: добавление, редактирование или ничего.
const expenseEditor = ref<ExpenseEditor | null>(null)

const nameDraft = ref('')
// Режим переименования: id участника + черновик имени; null — никто не редактируется.
const renamingId = ref<string | null>(null)
const renameDraft = ref('')

type Notice = { tone: 'error' | 'info'; text: string }
const notice = ref<Notice | null>(null)

// Кнопка активна при непустом имени (правило — из стейта, то же, что в addParticipant):
// отказ по лимиту приходит сообщением из мутации, а не молчаливой блокировкой —
// лимит объяснён в UI.
const canAdd = computed(() => !isBlank(nameDraft.value))

function showNotice(tone: Notice['tone'], text: string): void {
  notice.value = { tone, text }
}

function describeAddRefusal(result: Extract<AddParticipantResult, { ok: false }>): string {
  if (result.reason === 'empty-name') return 'Введите имя участника'
  return `Лимит поездки — ${result.max} участников, больше не добавить`
}

function describeRemoveRefusal(
  participant: Participant,
  result: Extract<RemoveParticipantResult, { ok: false }>,
): string {
  if (result.reason === 'not-found') return 'Участник уже удалён'
  const parts: string[] = []
  if (result.expenses > 0) {
    parts.push(`в ${result.expenses} ${plural(result.expenses, 'расходе', 'расходах', 'расходах')}`)
  }
  if (result.payments > 0) {
    parts.push(
      `в ${result.payments} ${plural(result.payments, 'выплате', 'выплатах', 'выплатах')}`,
    )
  }
  return `Нельзя удалить «${participant.name}»: участник фигурирует ${parts.join(' и ')}`
}

function submitAdd(): void {
  const result = addParticipant(nameDraft.value)
  if (result.ok) {
    nameDraft.value = ''
    notice.value = null
  } else {
    showNotice('error', describeAddRefusal(result))
  }
}

function startRename(participant: Participant): void {
  renamingId.value = participant.id
  renameDraft.value = participant.name
  notice.value = null
}

function submitRename(): void {
  if (renamingId.value === null) return
  const result = renameParticipant(renamingId.value, renameDraft.value)
  if (result.ok) {
    renamingId.value = null
  } else {
    showNotice('error', result.reason === 'empty-name' ? 'Имя не может быть пустым' : 'Участник не найден')
  }
}

function cancelRename(): void {
  renamingId.value = null
}

function remove(participant: Participant): void {
  const result = removeParticipant(participant.id)
  if (result.ok) {
    notice.value = null
  } else {
    showNotice('error', describeRemoveRefusal(participant, result))
  }
}

function regenerate(participant: Participant): void {
  regenerateAvatar(participant.id)
  notice.value = null
}

function describeExpenseRefusal(result: Extract<SaveExpenseResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not-found':
      return 'Расход уже удалён'
    case 'unknown-participant':
      return 'Участник больше не в поездке'
    case 'unknown-currency':
      return 'Валюта больше не в поездке'
    case 'limit':
      return `Лимит поездки — ${result.max} расходов`
    case 'split-mismatch':
      return 'Сплит не сходится'
    case 'empty-title':
      return 'Введите название'
    case 'bad-amount':
      return 'Введите сумму'
    case 'empty-split':
      return 'Выберите участников'
  }
}

function openAddExpense(): void {
  expenseEditor.value = { kind: 'add' }
  notice.value = null
}

function editExpense(expense: Expense): void {
  expenseEditor.value = { kind: 'edit', expense }
  notice.value = null
}

function cancelExpense(): void {
  expenseEditor.value = null
  notice.value = null
}

function saveExpense(input: ExpenseInput): void {
  const editor = expenseEditor.value
  if (!editor) return
  const result =
    editor.kind === 'edit' ? updateExpense(editor.expense.id, input) : addExpense(input)
  if (result.ok) {
    expenseEditor.value = null
    notice.value = null
  } else {
    showNotice('error', describeExpenseRefusal(result))
  }
}

// Расходы удаляются свободно, без подтверждения (тикет 09).
function removeExpenseFromList(expense: Expense): void {
  const result = removeExpense(expense.id)
  if (result.ok) {
    // Форма редактирования этого же расхода стала неактуальна — закрываем.
    if (
      expenseEditor.value?.kind === 'edit' &&
      expenseEditor.value.expense.id === expense.id
    ) {
      expenseEditor.value = null
    }
    notice.value = null
  } else {
    showNotice('error', 'Расход уже удалён')
  }
}

// Валюты: форма добавления открыта или нет — владеет экран, как редактором расходов.
const currencyAdding = ref(false)

function describeAddCurrencyRefusal(result: Extract<AddCurrencyResult, { ok: false }>): string {
  switch (result.reason) {
    case 'empty-code':
      return 'Введите код валюты'
    case 'duplicate':
      return `«${result.code}» уже в поездке`
    case 'limit':
      return `Лимит поездки — ${result.max} валют, больше не добавить`
    case 'bad-rate':
      return 'Введите курс — положительную десятичную дробь'
  }
}

function addCurrencyIntent(code: string, rate: Rational): void {
  const result = addCurrency(code, rate)
  if (result.ok) {
    // Отказ при закрытой форме сбросил бы черновик на середине ввода.
    currencyAdding.value = false
    notice.value = null
  } else {
    showNotice('error', describeAddCurrencyRefusal(result))
  }
}

function describeRateRefusal(result: Extract<UpdateCurrencyRateResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not-found':
      return 'Валюта уже удалена'
    case 'base-currency':
      return 'Базовая валюта всегда с курсом 1'
    case 'bad-rate':
      return 'Введите курс — положительную десятичную дробь'
  }
}

function updateRateIntent(code: string, rate: Rational): void {
  const result = updateCurrencyRate(code, rate)
  if (result.ok) {
    notice.value = null
  } else {
    showNotice('error', describeRateRefusal(result))
  }
}

function describeRemoveCurrencyRefusal(
  code: string,
  result: Extract<RemoveCurrencyResult, { ok: false }>,
): string {
  if (result.reason === 'not-found') return 'Валюта уже удалена'
  if (result.reason === 'base-currency') {
    return `«${code}» — базовая валюта поездки, её нельзя удалить`
  }
  const parts: string[] = []
  if (result.expenses > 0) {
    parts.push(
      `в ${result.expenses} ${plural(result.expenses, 'расходе', 'расходах', 'расходах')}`,
    )
  }
  if (result.payments > 0) {
    parts.push(
      `в ${result.payments} ${plural(result.payments, 'выплате', 'выплатах', 'выплатах')}`,
    )
  }
  return `Нельзя удалить «${code}»: валюта фигурирует ${parts.join(' и ')}`
}

function removeCurrencyIntent(code: string): void {
  const result = removeCurrency(code)
  if (result.ok) {
    notice.value = null
  } else {
    showNotice('error', describeRemoveCurrencyRefusal(code, result))
  }
}
</script>

<template>
  <div
    v-if="trip"
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <header
      class="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/90 px-5 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90"
    >
      <div class="mx-auto flex w-full max-w-md items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <svg viewBox="0 0 24 24" class="size-7 text-emerald-600" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.5" />
            <path d="M12 5.5 A 6 6 0 0 0 12 18.5 Z" fill="currentColor" />
          </svg>
          <div>
            <h1 class="text-lg leading-tight font-semibold">{{ trip.name }}</h1>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              Базовая валюта: {{ trip.baseCurrency }}
            </p>
          </div>
        </div>
        <span
          class="rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
        >
          Активна
        </span>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-6">
      <section
        class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        aria-labelledby="participants-heading"
      >
        <div class="flex items-baseline justify-between gap-3">
          <h2 id="participants-heading" class="font-medium">Участники</h2>
          <span class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {{ participants.length }} из {{ limit }}
          </span>
        </div>

        <p v-if="participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
          Пока никого нет. Добавьте первого участника — например, себя.
        </p>

        <TransitionGroup
          v-else
          tag="ul"
          name="participant"
          class="space-y-2"
          aria-label="Список участников"
        >
          <li
            v-for="participant in participants"
            :key="participant.id"
            class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
              :style="{ backgroundColor: participant.color + '33' }"
              >{{ participant.emoji }}</span
            >

            <template v-if="renamingId === participant.id">
              <input
                v-model="renameDraft"
                type="text"
                class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-700 dark:bg-zinc-900"
                aria-label="Новое имя участника"
                @keyup.enter="submitRename"
                @keyup.esc="cancelRename"
              />
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                aria-label="Сохранить имя"
                @click="submitRename"
              >
                ОК
              </button>
              <button
                type="button"
                class="rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 dark:text-zinc-400"
                aria-label="Отменить переименование"
                @click="cancelRename"
              >
                Отмена
              </button>
            </template>

            <template v-else>
              <span class="min-w-0 flex-1 truncate">{{ participant.name }}</span>
              <button
                type="button"
                class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                :aria-label="`Перегенерировать аватар участника ${participant.name}`"
                title="Другой цвет и эмодзи"
                @click="regenerate(participant)"
              >
                🎲
              </button>
              <button
                type="button"
                class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                :aria-label="`Переименовать участника ${participant.name}`"
                title="Переименовать"
                @click="startRename(participant)"
              >
                ✏️
              </button>
              <button
                type="button"
                class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                :aria-label="`Удалить участника ${participant.name}`"
                title="Удалить"
                @click="remove(participant)"
              >
                🗑️
              </button>
            </template>
          </li>
        </TransitionGroup>

        <form class="flex gap-2" @submit.prevent="submitAdd">
          <input
            v-model="nameDraft"
            type="text"
            autocomplete="off"
            placeholder="Имя участника"
            class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            :disabled="!canAdd"
            class="rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            Добавить
          </button>
        </form>
      </section>

      <ExpensesCard
        :participants="participants"
        :expenses="trip.expenses"
        :currencies="trip.currencies"
        :base-currency="trip.baseCurrency"
        :editing="expenseEditor"
        @open="openAddExpense"
        @edit="editExpense"
        @remove="removeExpenseFromList"
        @save="saveExpense"
        @cancel="cancelExpense"
      />

      <CurrenciesCard
        :currencies="trip.currencies"
        :base-currency="trip.baseCurrency"
        :adding="currencyAdding"
        @open="currencyAdding = true; notice = null"
        @add="addCurrencyIntent"
        @update-rate="updateRateIntent"
        @remove="removeCurrencyIntent"
        @cancel="currencyAdding = false; notice = null"
      />

      <p
        v-if="notice"
        role="alert"
        class="text-sm"
        :class="
          notice.tone === 'error'
            ? 'text-red-600 dark:text-red-400'
            : 'text-zinc-500 dark:text-zinc-400'
        "
      >
        {{ notice.text }}
      </p>

      <section
        class="rounded-2xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
        aria-label="Что дальше"
      >
        Дальше — балансы и минимальные переводы. Эти разделы появятся в
        следующих обновлениях.
      </section>
    </main>

    <footer class="px-5 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
      Работает офлайн · данные хранятся только на устройстве
    </footer>
  </div>
</template>

<style scoped>
/* Появление/уход участника — единственная анимация списка (правило: Vue-переходы). */
.participant-enter-active,
.participant-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.participant-enter-from,
.participant-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
