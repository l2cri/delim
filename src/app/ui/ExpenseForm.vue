<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Currency, Expense, Participant, Split } from '../../core'
import { convertToBase, splitAmounts } from '../../core'
import { isBlank, splitDelta } from '../state/validation'
import type { ExpenseInput } from '../state/useTrip'
import { formatMinor } from './format'
import AmountInput from './AmountInput.vue'

// Управляемая форма расхода: внутри — только черновики и их отображение. Все
// правила (пустота названия, сходимость сплита) и деньги (доли, конвертация) —
// вызовами стейта и ядра: isBlank/splitDelta/splitAmounts/convertToBase.

const props = defineProps<{
  participants: Participant[]
  currencies: Currency[]
  baseCurrency: string
  /** null — добавление нового расхода, объект — редактирование существующего. */
  editing: Expense | null
}>()

const emit = defineEmits<{
  save: [input: ExpenseInput]
  cancel: []
}>()

type SplitMode = 'equal' | 'exact' | 'shares'

/**
 * Построчный черновик участника: три режима сплита читают одни и те же строки
 * параллельно, поэтому переключение вкладок ничего не теряет.
 */
type Row = {
  selected: boolean
  /** Введённая точная сумма (минорные); null — не введена. */
  exact: number | null
  /** Вес доли; '' — поле веса очищено (v-model.number отдаёт пустую строку). */
  weight: number | ''
}

const TABS: readonly { mode: SplitMode; label: string }[] = [
  { mode: 'equal', label: 'Поровну' },
  { mode: 'exact', label: 'Точными суммами' },
  { mode: 'shares', label: 'Долями' },
]

function defaultRow(): Row {
  return { selected: false, exact: null, weight: 1 }
}

// Префилл: новая трата — первый участник, базовая валюта, «поровну», все выбраны;
// редактирование — поля расхода и его режим сплита.
const title = ref(props.editing?.title ?? '')
const payerId = ref(props.editing?.payerId ?? props.participants[0]?.id ?? '')
const amount = ref<number | null>(props.editing?.amount ?? null)
const currencyCode = ref(props.editing?.currencyCode ?? props.baseCurrency)
const mode = ref<SplitMode>(props.editing?.split.mode ?? 'equal')

// Редактируемая ссылка могла устареть (валюту удалили из поездки) — база как фолбэк.
if (!props.currencies.some((c) => c.code === currencyCode.value)) {
  currencyCode.value = props.baseCurrency
}
if (!props.participants.some((p) => p.id === payerId.value)) {
  payerId.value = props.participants[0]?.id ?? ''
}

const rows = ref<Record<string, Row>>({})
for (const participant of props.participants) {
  rows.value[participant.id] = defaultRow()
}
if (props.editing) {
  const split = props.editing.split
  if (split.mode === 'equal') {
    for (const id of split.participantIds) {
      if (rows.value[id]) rows.value[id].selected = true
    }
  } else if (split.mode === 'exact') {
    for (const share of split.shares) {
      const row = rows.value[share.participantId]
      if (row) {
        row.selected = true
        row.exact = share.amount
      }
    }
  } else {
    for (const share of split.shares) {
      const row = rows.value[share.participantId]
      if (row) {
        row.selected = true
        row.weight = share.weight
      }
    }
  }
} else {
  for (const participant of props.participants) {
    rows.value[participant.id].selected = true
  }
}

// Участник, добавленный при открытой форме, получает строку-черновик по умолчанию.
watch(
  () => props.participants,
  (participants) => {
    for (const participant of participants) {
      if (!rows.value[participant.id]) rows.value[participant.id] = defaultRow()
    }
  },
)

// Выбранные id в порядке participants — так же собирается split при сохранении.
const selectedIds = computed(() =>
  props.participants.filter((p) => rows.value[p.id]?.selected).map((p) => p.id),
)

/** Введённая положительная сумма либо null — предусловие splitAmounts/convertToBase. */
const positiveAmount = computed(() => {
  const value = amount.value
  return value !== null && value > 0 ? value : null
})

/** Доля для показа в строке; «—» — сумму не ввели или вес некорректен. */
function previewShare(shares: ReadonlyMap<string, number>, id: string): string {
  const value = shares.get(id)
  return value === undefined ? '—' : formatMinor(value)
}

/** Вес корректен, если это целое ≥ 1 (пустое и дробное поле блокируют сохранение). */
function isWholeWeight(weight: number | ''): weight is number {
  return typeof weight === 'number' && Number.isInteger(weight) && weight >= 1
}

// Доли «поровну» по текущей сумме — превью строк и помощник для точного сплита.
const equalShares = computed(() => {
  const map = new Map<string, number>()
  const total = positiveAmount.value
  const ids = selectedIds.value
  if (total === null || ids.length === 0) return map
  for (const share of splitAmounts(total, { mode: 'equal', participantIds: ids })) {
    map.set(share.participantId, share.amount)
  }
  return map
})

/** Черновик сплита долями из валидных весов; null — есть пустой/дробный вес. */
const sharesDraft = computed<Split | null>(() => {
  const ids = selectedIds.value
  if (ids.length === 0) return null
  const shares: { participantId: string; weight: number }[] = []
  for (const id of ids) {
    const weight = rows.value[id].weight
    if (!isWholeWeight(weight)) return null
    shares.push({ participantId: id, weight })
  }
  return { mode: 'shares', shares }
})

const sharesPreview = computed(() => {
  const map = new Map<string, number>()
  const total = positiveAmount.value
  const draft = sharesDraft.value
  if (total === null || draft === null) return map
  for (const share of splitAmounts(total, draft)) {
    map.set(share.participantId, share.amount)
  }
  return map
})

/** Введённые суммы выбранных строк точного сплита (строки без суммы — вклад 0). */
const exactEntered = computed(() => {
  const shares: { participantId: string; amount: number }[] = []
  for (const id of selectedIds.value) {
    const exact = rows.value[id].exact
    if (exact !== null) shares.push({ participantId: id, amount: exact })
  }
  return shares
})

const exactCovered = computed(() =>
  exactEntered.value.reduce((sum, share) => sum + share.amount, 0),
)

/**
 * Переключение вкладок ничего не теряет; единственный помощник — переход
 * в «Точными суммами»: выбранным без суммы подставляется поровну-доля от
 * текущей суммы, введённое не трогается; при некорректной сумме — не считаем.
 */
function switchMode(next: SplitMode): void {
  if (next === 'exact' && mode.value !== 'exact') {
    const total = positiveAmount.value
    const ids = selectedIds.value
    if (total !== null && ids.length > 0) {
      for (const share of splitAmounts(total, {
        mode: 'equal',
        participantIds: ids,
      })) {
        const row = rows.value[share.participantId]
        if (row && row.exact === null) row.exact = share.amount
      }
    }
  }
  mode.value = next
}

/** Живая строка состояния сплита под списком участников. */
const status = computed<{ tone: 'ok' | 'mismatch'; text: string } | null>(() => {
  const total = positiveAmount.value
  if (total === null) return null
  if (mode.value === 'exact') {
    const delta = exactEntered.value.length === 0 ? total : splitDelta(total, { mode: 'exact', shares: exactEntered.value })
    const covered = formatMinor(exactCovered.value)
    if (delta > 0) {
      return { tone: 'mismatch', text: `Распределено ${covered} из ${formatMinor(total)}: не хватает ${formatMinor(delta)}` }
    }
    if (delta < 0) {
      return { tone: 'mismatch', text: `Распределено ${covered} из ${formatMinor(total)}: лишние ${formatMinor(-delta)}` }
    }
    return { tone: 'ok', text: `Распределено ровно ${formatMinor(total)}` }
  }
  // Поровну и долями ядро делит всегда нацело (наибольшие остатки).
  return { tone: 'ok', text: `Распределено ровно ${formatMinor(total)}` }
})

const canSave = computed(() => {
  if (isBlank(title.value)) return false
  if (positiveAmount.value === null) return false
  if (!props.participants.some((p) => p.id === payerId.value)) return false
  if (!props.currencies.some((c) => c.code === currencyCode.value)) return false
  const ids = selectedIds.value
  if (ids.length === 0) return false
  if (mode.value === 'exact') {
    // Все выбранные ввели суммы и сплит сходится ровно.
    return exactEntered.value.length === ids.length && status.value?.tone === 'ok'
  }
  if (mode.value === 'shares') {
    return sharesDraft.value !== null
  }
  return true
})

/** Эквивалент в базовой валюте под суммой; null — валюта расхода и есть базовая. */
const baseEquivalent = computed(() => {
  if (currencyCode.value === props.baseCurrency) return null
  const rate = props.currencies.find((c) => c.code === currencyCode.value)?.rate
  const total = positiveAmount.value
  if (!rate || total === null) return null
  return `≈ ${formatMinor(convertToBase(total, rate))} ${props.baseCurrency}`
})

/** Сборка сплита из черновика; вызывается только при canSave (суммы и веса уже проверены). */
function buildSplit(): Split {
  const ids = selectedIds.value
  if (mode.value === 'equal') {
    return { mode: 'equal', participantIds: ids }
  }
  if (mode.value === 'shares') {
    return {
      mode: 'shares',
      shares: ids.map((id) => ({ participantId: id, weight: rows.value[id].weight as number })),
    }
  }
  return {
    mode: 'exact',
    shares: ids.map((id) => ({ participantId: id, amount: rows.value[id].exact as number })),
  }
}

function submit(): void {
  const total = positiveAmount.value
  if (total === null || !canSave.value) return
  emit('save', {
    title: title.value,
    payerId: payerId.value,
    amount: total,
    currencyCode: currencyCode.value,
    split: buildSplit(),
  })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <p v-if="participants.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы вносить расходы
    </p>

    <template v-else>
      <input
        v-model="title"
        type="text"
        autocomplete="off"
        placeholder="Название расхода"
        aria-label="Название расхода"
        class="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />

      <AmountInput
        v-model="amount"
        placeholder="Например, 1500/4"
        aria-label="Сумма расхода"
      />
      <p
        v-if="baseEquivalent"
        aria-live="polite"
        class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400"
      >
        {{ baseEquivalent }}
      </p>

      <div class="flex gap-2">
        <select
          v-model="payerId"
          aria-label="Плательщик"
          class="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option v-for="participant in participants" :key="participant.id" :value="participant.id">
            {{ participant.name }}
          </option>
        </select>
        <select
          v-model="currencyCode"
          aria-label="Валюта расхода"
          class="w-28 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-base tabular-nums text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option v-for="currency in currencies" :key="currency.code" :value="currency.code">
            {{ currency.code }}
          </option>
        </select>
      </div>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Режим сплита">
        <button
          v-for="tab in TABS"
          :key="tab.mode"
          type="button"
          class="rounded-full border px-3.5 py-2 text-sm font-medium transition-colors"
          :class="
            mode === tab.mode
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
          "
          :aria-pressed="mode === tab.mode"
          @click="switchMode(tab.mode)"
        >
          {{ tab.label }}
        </button>
      </div>

      <ul class="space-y-2" aria-label="Участники сплита">
        <li
          v-for="participant in participants"
          :key="participant.id"
          class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
        >
          <input
            v-model="rows[participant.id].selected"
            type="checkbox"
            class="size-4 shrink-0 accent-emerald-600"
            :aria-label="participant.name"
          />
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full text-base"
            :style="{ backgroundColor: participant.color + '33' }"
            >{{ participant.emoji }}</span
          >
          <span class="min-w-0 flex-1 truncate">{{ participant.name }}</span>

          <span
            v-if="mode === 'equal'"
            class="shrink-0 text-sm tabular-nums text-zinc-500 dark:text-zinc-400"
          >
            {{ previewShare(equalShares, participant.id) }}
          </span>

          <template v-else-if="mode === 'shares'">
            <input
              v-model.number="rows[participant.id].weight"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              :aria-label="`Доля ${participant.name}`"
              class="w-16 rounded-lg border bg-white px-2 py-1.5 text-right text-sm tabular-nums text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:bg-zinc-900 dark:text-zinc-100"
              :class="
                isWholeWeight(rows[participant.id].weight)
                  ? 'border-zinc-300 dark:border-zinc-700'
                  : 'border-red-500'
              "
            />
            <span class="shrink-0 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
              {{ previewShare(sharesPreview, participant.id) }}
            </span>
          </template>

          <div v-else class="w-32 shrink-0 sm:w-36">
            <AmountInput
              v-model="rows[participant.id].exact"
              compact
              placeholder="0"
              :aria-label="`Сумма доли ${participant.name}`"
            />
          </div>
        </li>
      </ul>

      <p
        v-if="status"
        aria-live="polite"
        class="text-sm tabular-nums"
        :class="
          status.tone === 'ok'
            ? 'text-zinc-500 dark:text-zinc-400'
            : 'text-red-600 dark:text-red-400'
        "
      >
        {{ status.text }}
      </p>
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
        {{ editing ? 'Сохранить расход' : 'Добавить расход' }}
      </button>
    </div>
  </form>
</template>
