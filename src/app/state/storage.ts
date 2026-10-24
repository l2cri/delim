import type { TripState } from '../../core'

/**
 * Адаптер localStorage активной поездки (ADR 0008): один ключ и примитивы
 * чтения/записи/очистки. Тонкий и заменяемый — useTrip не знает о формате
 * ключей, тесты импортируют константу вместо дублирования строки.
 */

export const STORAGE_KEY = 'delim:active-trip'

/** Архив глубины 1 (ADR 0002): последняя завершённая поездка, только чтение. */
export const ARCHIVE_STORAGE_KEY = 'delim:archived-trip'

export function readStoredTrip(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function writeStoredTrip(state: TripState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearStoredTrip(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function readArchivedTrip(): string | null {
  return localStorage.getItem(ARCHIVE_STORAGE_KEY)
}

export function writeArchivedTrip(state: TripState): void {
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(state))
}

export function clearArchivedTrip(): void {
  localStorage.removeItem(ARCHIVE_STORAGE_KEY)
}
