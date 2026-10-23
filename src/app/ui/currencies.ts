// Пресет популярных валют поездок (SPEC, Further Notes) — один источник для двух
// экранов: выбора базовой валюты при создании поездки и добавления валют в
// настройках действующей. Произвольный код — вручную, пресет только ускоряет.

export const PRESET_CURRENCIES: readonly string[] = [
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

/** Символы пресета для кнопок; у своих валют код и есть обозначение. */
export const CURRENCY_SYMBOLS: Record<string, string> = {
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
