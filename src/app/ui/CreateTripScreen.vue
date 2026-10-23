<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTrip } from '../state/useTrip'
import type { CreateTripResult } from '../state/useTrip'
import { isBlank } from '../state/validation'

// Пресет популярных валют поездок (спека, Further Notes); произвольный код —
// вручную. Валюта здесь только выбирается: все деньги считает ядро.
const PRESET_CURRENCIES: readonly string[] = [
  'RUB',
  'USD',
  'EUR',
  'GBP',
  'KZT',
  'TRY',
  'AED',
  'THB',
  'GEL',
  'CNY',
]

const SYMBOLS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  GBP: '£',
  KZT: '₸',
  TRY: '₺',
  AED: 'AED',
  THB: '฿',
  GEL: '₾',
  CNY: '¥',
}

const { createTrip } = useTrip()

const name = ref('')
// Пустая строка — валюта не выбрана; кастомный ввод живёт в том же значении.
const currency = ref('')
const customDraft = ref('')
const error = ref('')

// Правило пустоты — из стейта (validation.ts), то же, что отказывает в createTrip.
const canCreate = computed(() => !isBlank(name.value) && !isBlank(currency.value))

function selectPreset(code: string): void {
  currency.value = code
  customDraft.value = ''
  error.value = ''
}

function applyCustom(): void {
  const code = customDraft.value.trim().toUpperCase()
  if (code) {
    currency.value = code
    error.value = ''
  }
}

function submit(): void {
  // Сначала коммитим черновик своей валюты: Enter в названии создаёт поездку
  // сразу после ввода кода, без блура поля валюты.
  applyCustom()
  const result: CreateTripResult = createTrip({
    name: name.value,
    baseCurrency: currency.value,
  })
  if (!result.ok) {
    // Кнопка неактивна при пустых полях; отказ здесь — защита на случай рассинхрона.
    error.value =
      result.reason === 'empty-name'
        ? 'Введите название поездки'
        : 'Выберите базовую валюту'
  }
}
</script>

<template>
  <div
    class="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
  >
    <header class="mx-auto flex w-full max-w-md items-center gap-3 px-5 pt-8">
      <svg viewBox="0 0 24 24" class="size-8 text-emerald-600" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.5" />
        <path d="M12 5.5 A 6 6 0 0 0 12 18.5 Z" fill="currentColor" />
      </svg>
      <span class="text-xl font-semibold tracking-tight">Делим</span>
    </header>

    <main class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-10">
      <section class="space-y-2 text-center">
        <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">
          Долги поездки — в минимум переводов
        </h2>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
          Поровну, точными суммами или долями — в любых валютах с ручными курсами.
          Без регистрации, сервера и сети.
        </p>
      </section>

      <section
        class="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        aria-labelledby="create-trip-heading"
      >
        <h3 id="create-trip-heading" class="font-medium">Новая поездка</h3>

        <div class="space-y-2">
          <label for="trip-name" class="block text-sm font-medium">Название</label>
          <input
            id="trip-name"
            v-model="name"
            type="text"
            autocomplete="off"
            placeholder="Например, Грузия-2026"
            class="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            @keyup.enter="submit"
          />
        </div>

        <fieldset class="space-y-2">
          <legend class="block text-sm font-medium">Базовая валюта</legend>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Популярные валюты">
            <button
              v-for="code in PRESET_CURRENCIES"
              :key="code"
              type="button"
              class="rounded-full border px-3.5 py-2 text-sm font-medium transition-colors"
              :class="
                currency === code
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
              "
              :aria-pressed="currency === code"
              @click="selectPreset(code)"
            >
              {{ SYMBOLS[code] ?? code }}
              <span class="ml-1 text-xs opacity-70">{{ code }}</span>
            </button>
          </div>
          <div class="flex items-center gap-2">
            <input
              v-model="customDraft"
              type="text"
              autocomplete="off"
              placeholder="Своя валюта, код"
              maxlength="5"
              class="w-36 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm uppercase text-zinc-900 outline-none transition-colors placeholder:normal-case placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              @change="applyCustom"
              @keyup.enter="applyCustom"
            />
            <span v-if="currency && !PRESET_CURRENCIES.includes(currency)" class="text-sm text-emerald-600 dark:text-emerald-400">
              Выбрано: {{ currency }}
            </span>
          </div>
        </fieldset>

        <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

        <button
          type="button"
          :disabled="!canCreate"
          :aria-disabled="!canCreate"
          class="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          @click="submit"
        >
          Создать поездку
        </button>
      </section>
    </main>

    <footer class="px-5 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
      Работает офлайн · данные хранятся только на устройстве
    </footer>
  </div>
</template>
