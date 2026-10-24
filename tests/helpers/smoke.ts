// Общие хелперы дымовых тестов экранов (тикет 12): монтирование App, нормализация
// текста, сидирование поездки в хранилище и типовые действия «как руками». До сих
// пор копировались в каждый smoke-файл — собраны сюда по замечанию P3 ревью #11.
// Синглтоны стейта каждый тест сбрасывает сам через vi.resetModules(), поэтому
// App импортируется динамически уже после сброса (mountApp); остальное — чистые
// функции поверх ядра и DOM.

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createNewTrip } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from './flushWatchers'

/** Общая дата создания сидированных записей. */
export const ISO = '2026-10-01T10:00:00.000Z'

export async function mountApp(): Promise<VueWrapper> {
  const { default: App } = await import('../../src/App.vue')
  return mount(App)
}

/** Формат сумм группирует разряды неразрывным пробелом — в ожиданиях это обычный пробел. */
export function norm(text: string): string {
  return text.replace(/\u00A0/g, ' ')
}

/** Кладёт в хранилище свежую поездку «Кипр» (RUB) с довеской вызывающего теста. */
export function seedTrip(mutate: (state: TripState) => void): void {
  const state = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  mutate(state)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export async function addParticipant(wrapper: VueWrapper, name: string): Promise<void> {
  // happy-dom не поднимает submit по клику кнопки — триггерим форму, как браузер.
  await wrapper.find('input[placeholder="Имя участника"]').setValue(name)
  await wrapper.find('form').trigger('submit')
  await flush()
}

/** Свежая поездка «Кипр» (RUB) с участниками — через экраны, как это делает пользователь. */
export async function mountTripWith(names: string[]): Promise<VueWrapper> {
  const wrapper = await mountApp()
  await wrapper.find('#trip-name').setValue('Кипр')
  await wrapper.findAll('button').find((b) => b.text().includes('RUB'))!.trigger('click')
  await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
  await flush()
  for (const name of names) await addParticipant(wrapper, name)
  return wrapper
}

/** Добавляет расход поровну между всеми: форма по умолчанию — режим «Поровну». */
export async function addEqualExpense(
  wrapper: VueWrapper,
  title: string,
  amount: string,
): Promise<void> {
  await wrapper.findAll('button').find((b) => b.text().includes('Добавить расход'))!.trigger('click')
  await flush()
  await wrapper.find('input[placeholder="Название расхода"]').setValue(title)
  await wrapper.find('input[aria-label="Сумма расхода"]').setValue(amount)
  const form = wrapper
    .findAll('form')
    .find((f) => f.text().includes('Добавить расход') || f.text().includes('Сохранить расход'))
  if (!form) throw new Error('форма расхода не открыта')
  await form.trigger('submit')
  await flush()
}

/** Строки балансов — нормированные тексты по порядку (порядок и есть сортировка экрана). */
export function balanceTexts(wrapper: VueWrapper): string[] {
  return wrapper
    .find('[aria-label="Список балансов"]')
    .findAll('li')
    .map((li) => norm(li.text()))
}

/** Строки переводов — нормированные тексты в порядке седения. */
export function transferTexts(wrapper: VueWrapper): string[] {
  return wrapper
    .find('[aria-label="Список переводов"]')
    .findAll('li')
    .map((li) => norm(li.text()))
}

/** Поездка четырьмя участниками и расходом 1000,00 RUB (плательщица Аня, поровну
 * на троих) — балансы: Аня +666,66, Боря и Вика −333,33, Гоша — ноль. */
export function seedWithZeroBalance(): void {
  seedTrip((state) => {
    state.participants.push(
      { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
      { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
      { id: 'p3', name: 'Вика', color: '#d97706', emoji: '🦊' },
      { id: 'p4', name: 'Гоша', color: '#dc2626', emoji: '🐺' },
    )
    state.expenses.push({
      id: 'e1',
      title: 'Ужин',
      payerId: 'p1',
      amount: 100000,
      currencyCode: 'RUB',
      createdAt: ISO,
      split: { mode: 'equal', participantIds: ['p1', 'p2', 'p3'] },
    })
  })
}
