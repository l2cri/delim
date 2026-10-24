<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Currency, Rational } from '../../core'
import { parseRate, TRIP_LIMITS } from '../../core'
import { isBlank } from '../state/validation'
import { CURRENCY_SYMBOLS, PRESET_CURRENCIES } from './currencies'
import { formatRate } from './format'

// Секция «Валюты и курсы» — настройки поездки. Все правила (дубликат, лимит,
// занятость валюты, неприкосновенность базовой) — в useTrip; здесь черновики
// и человекочитаемое отображение курса. Деньги не считаются: разбор дроби —
// parseRate ядра, показ — formatRate.

const props = withDefaults(
  defineProps<{
    currencies: Currency[]
    baseCurrency: string
    /** Открыта ли форма добавления — состоянием владеет экран, как редактором расходов. */
    adding: boolean
    /** Режим зрителя (тикет 15): только список с курсами, без форм и кнопок. */
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  /** Клик «+ Добавить валюту». */
  open: []
  add: [code: string, rate: Rational]
  updateRate: [code: string, rate: Rational]
  remove: [code: string]
  cancel: []
}>()

const limit = TRIP_LIMITS.currencies

function isBase(code: string): boolean {
  return code === props.baseCurrency
}

// Пресет без уже добавленных: chips предлагают только новое.
const availablePresets = computed(() =>
  PRESET_CURRENCIES.filter((code) => !props.currencies.some((c) => c.code === code)),
)

// Черновики формы добавления живут, пока форма открыта; закрытие (успех или
// отмена) сбрасывает их — открытие всегда начинается с чистого листа.
const codeDraft = ref('')
const customDraft = ref('')
const addRateDraft = ref('')

const addRate = computed(() => parseRate(addRateDraft.value))
const addRateInvalid = computed(() => addRateDraft.value.trim() !== '' && !addRate.value.ok)

// Правило пустоты кода — из стейта (validation.ts), то же, что отказывает в addCurrency.
const canAdd = computed(() => !isBlank(codeDraft.value) && addRate.value.ok)

watch(
  () => props.adding,
  (open) => {
    if (!open) {
      codeDraft.value = ''
      customDraft.value = ''
      addRateDraft.value = ''
    }
  },
)

function selectPreset(code: string): void {
  codeDraft.value = code
  customDraft.value = ''
}

function applyCustom(): void {
  const code = customDraft.value.trim().toUpperCase()
  if (code) codeDraft.value = code
}

function submitAdd(): void {
  if (!canAdd.value || !addRate.value.ok) return
  emit('add', codeDraft.value.trim(), addRate.value.rate)
}

/** Живой предпросмотр «1 GEL = 29,5 RUB» под полями формы добавления. */
const addPreview = computed(() => {
  const code = codeDraft.value.trim()
  if (!code || !addRate.value.ok) return null
  return `1 ${code} = ${formatRate(addRate.value.rate)} ${props.baseCurrency}`
})

// Правка курса — построчный инлайн, как переименование участника: черновик
// создаётся из текущего курса, судьба отказа — на экране (уведомление).
const rateEditCode = ref<string | null>(null)
const rateDraft = ref('')

const rateInvalid = computed(() => rateDraft.value.trim() !== '' && !parseRate(rateDraft.value).ok)

function startRateEdit(currency: Currency): void {
  rateEditCode.value = currency.code
  rateDraft.value = formatRate(currency.rate)
}

function cancelRateEdit(): void {
  rateEditCode.value = null
}

function submitRateEdit(): void {
  const code = rateEditCode.value
  const parsed = parseRate(rateDraft.value)
  if (code === null || !parsed.ok) return
  rateEditCode.value = null
  emit('updateRate', code, parsed.rate)
}
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="currencies-heading"
  >
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="currencies-heading" class="font-medium">Валюты и курсы</h2>
      <span class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        {{ currencies.length }} из {{ limit }}
      </span>
    </div>

    <TransitionGroup tag="ul" name="currency" class="space-y-2" aria-label="Список валют">
      <li
        v-for="currency in currencies"
        :key="currency.code"
        class="flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/40"
      >
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-sm font-semibold text-emerald-700 dark:text-emerald-400"
        >
          {{ CURRENCY_SYMBOLS[currency.code] ?? currency.code }}
        </span>

        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 text-sm font-medium">
            <span class="truncate">{{ currency.code }}</span>
            <span
              v-if="isBase(currency.code)"
              class="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              базовая
            </span>
          </p>
          <p v-if="!isBase(currency.code)" class="truncate text-xs text-zinc-500 dark:text-zinc-400">
            1 {{ currency.code }} = {{ formatRate(currency.rate) }} {{ baseCurrency }}
          </p>
        </div>

        <!-- Зритель не правит курсы: обе ветки управления только организатору. -->
        <template v-if="!readonly && rateEditCode === currency.code">
          <input
            v-model="rateDraft"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :aria-label="`Новый курс ${currency.code}`"
            :aria-invalid="rateInvalid ? 'true' : undefined"
            class="w-24 rounded-lg border bg-white px-2.5 py-1.5 text-right text-base tabular-nums text-zinc-900 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:bg-zinc-900 dark:text-zinc-100"
            :class="rateInvalid ? 'border-red-500' : 'border-zinc-300 dark:border-zinc-700'"
            @keyup.enter="submitRateEdit"
            @keyup.esc="cancelRateEdit"
          />
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
            :aria-label="`Сохранить курс ${currency.code}`"
            @click="submitRateEdit"
          >
            ОК
          </button>
          <button
            type="button"
            class="rounded-lg px-2.5 py-1.5 text-sm text-zinc-500 dark:text-zinc-400"
            aria-label="Отменить правку курса"
            @click="cancelRateEdit"
          >
            Отмена
          </button>
        </template>

        <!-- Курс базовой валюты не задаётся и сама она не удаляется (схема: 1/1). -->
        <template v-else-if="!readonly && !isBase(currency.code)">
          <button
            type="button"
            class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            :aria-label="`Изменить курс ${currency.code}`"
            title="Изменить курс"
            @click="startRateEdit(currency)"
          >
            ✏️
          </button>
          <button
            type="button"
            class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
            :aria-label="`Удалить валюту ${currency.code}`"
            title="Удалить"
            @click="emit('remove', currency.code)"
          >
            🗑️
          </button>
        </template>
      </li>
    </TransitionGroup>

    <!-- Форма добавления и её кнопка-вход — только организатору; зритель видит
         лишь список валют выше. Пресеты (chips) — часть формы и прячутся с ней. -->
    <form v-if="!readonly && adding" class="space-y-3" @submit.prevent="submitAdd">
      <div v-if="availablePresets.length > 0" class="flex flex-wrap gap-2" role="group" aria-label="Популярные валюты">
        <button
          v-for="code in availablePresets"
          :key="code"
          type="button"
          class="rounded-full border px-3.5 py-2 text-sm font-medium transition-colors"
          :class="
            codeDraft === code
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
          "
          :aria-pressed="codeDraft === code"
          @click="selectPreset(code)"
        >
          {{ CURRENCY_SYMBOLS[code] ?? code }}
          <span class="ml-1 text-xs opacity-70">{{ code }}</span>
        </button>
      </div>

      <div class="flex gap-2">
        <input
          v-model="customDraft"
          type="text"
          autocomplete="off"
          placeholder="Своя валюта, код"
          maxlength="5"
          aria-label="Код валюты"
          class="w-32 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm uppercase text-zinc-900 outline-none transition-colors placeholder:normal-case placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          @change="applyCustom"
          @keyup.enter="applyCustom"
        />
        <input
          v-model="addRateDraft"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="Курс, например 29,5"
          aria-label="Курс к базовой валюте"
          :aria-invalid="addRateInvalid ? 'true' : undefined"
          class="min-w-0 flex-1 rounded-xl border bg-white px-4 py-3 text-base tabular-nums text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          :class="addRateInvalid ? 'border-red-500' : 'border-zinc-200 dark:border-zinc-800'"
        />
      </div>

      <p
        v-if="addPreview"
        aria-live="polite"
        class="text-sm tabular-nums text-zinc-500 dark:text-zinc-400"
      >
        {{ addPreview }}
      </p>
      <p v-else class="text-xs text-zinc-500 dark:text-zinc-400">
        Курс — сколько {{ baseCurrency }} стоит 1 единица валюты; правка пересчитает
        расходы и балансы всей поездки.
      </p>

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
          :disabled="!canAdd"
          class="flex-1 rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          Добавить валюту
        </button>
      </div>
    </form>

    <button
      v-else-if="!readonly"
      type="button"
      class="w-full rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:border-emerald-500 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
      @click="emit('open')"
    >
      + Добавить валюту
    </button>
  </section>
</template>

<style scoped>
/* Появление/уход валюты — та же анимация, что у участников и расходов. */
.currency-enter-active,
.currency-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.currency-enter-from,
.currency-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
