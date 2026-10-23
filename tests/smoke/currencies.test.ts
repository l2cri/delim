import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createNewTrip } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/**
 * Дымовые тесты настроек валют (qa-acceptance): гоняют только то, что видит
 * пользователь, через корневой App — пресет и своя валюта, живая правка курса,
 * удаления с отказами и лимит 10. Синглтоны стейта сбрасываются реестром
 * модулей: каждый тест — «чистая сессия» приложения (паттерн expenses.test.ts).
 */
async function mountApp(): Promise<VueWrapper> {
  const { default: App } = await import('../../src/App.vue')
  return mount(App)
}

/** Формат сумм и курсов группирует разряды неразрывным пробелом — в ожиданиях это обычный пробел. */
function norm(text: string): string {
  return text.replace(/\u00A0/g, ' ')
}

async function addParticipant(wrapper: VueWrapper, name: string): Promise<void> {
  await wrapper.find('input[placeholder="Имя участника"]').setValue(name)
  await wrapper.find('form').trigger('submit')
  await flush()
}

/** Свежая поездка «Кипр» (RUB) с участниками — через экраны, как это делает пользователь. */
async function mountTripWith(names: string[]): Promise<VueWrapper> {
  const wrapper = await mountApp()
  await wrapper.find('#trip-name').setValue('Кипр')
  await wrapper.findAll('button').find((b) => b.text().includes('RUB'))!.trigger('click')
  await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
  await flush()
  for (const name of names) await addParticipant(wrapper, name)
  return wrapper
}

/** Кнопка «+ Добавить валюту» под списком валют. */
async function openCurrencyForm(wrapper: VueWrapper): Promise<void> {
  await wrapper.findAll('button').find((b) => b.text() === '+ Добавить валюту')!.trigger('click')
  await flush()
}

/** Submit формы добавления валюты: happy-dom не поднимает submit по клику кнопки. */
async function submitCurrencyForm(wrapper: VueWrapper): Promise<void> {
  const form = wrapper
    .findAll('form')
    .find((f) => f.find('input[aria-label="Курс к базовой валюте"]').exists())
  if (!form) throw new Error('форма добавления валюты не открыта')
  await form.trigger('submit')
  await flush()
}

/** Кладёт в хранилище поездку RUB + EUR (курс 3/1), Аня и Боря, расход 10 EUR поровну. */
function seedEuroTripWithExpense(): void {
  const state: TripState = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  state.currencies.push({ code: 'EUR', rate: { num: 3, den: 1 } })
  state.participants.push(
    { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
    { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
  )
  state.expenses.push({
    id: 'e1',
    title: 'Ужин',
    payerId: 'p1',
    amount: 1000,
    currencyCode: 'EUR',
    createdAt: ISO,
    split: { mode: 'equal', participantIds: ['p1', 'p2'] },
  })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Строки списка валют — нормированные тексты по порядку. */
function currencyRows(wrapper: VueWrapper): string[] {
  return wrapper
    .find('[aria-label="Список валют"]')
    .findAll('li')
    .map((li) => norm(li.text()))
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: beforeunload гасит отложенный дебаунс-сейв (фикс флакера 03).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
})

describe('валюты: добавление', () => {
  it('пресет GEL с курсом 29,5 — строка «1 GEL = 29,5 RUB», счётчик 2 из 10', async () => {
    const wrapper = await mountTripWith(['Аня'])

    await openCurrencyForm(wrapper)
    await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
    await wrapper.find('input[aria-label="Курс к базовой валюте"]').setValue('29,5')
    expect(norm(wrapper.text())).toContain('1 GEL = 29,5 RUB')

    await submitCurrencyForm(wrapper)

    expect(currencyRows(wrapper)[1]).toContain('1 GEL = 29,5 RUB')
    expect(norm(wrapper.text())).toContain('2 из 10')
  })

  it('своя валюта вручную: amd → AMD с курсом 0,2; повтор — отказ «уже в поездке»', async () => {
    const wrapper = await mountTripWith(['Аня'])

    await openCurrencyForm(wrapper)
    await wrapper.find('input[aria-label="Код валюты"]').setValue('amd')
    await wrapper.find('input[aria-label="Код валюты"]').trigger('change')
    await wrapper.find('input[aria-label="Курс к базовой валюте"]').setValue('0.2')
    await submitCurrencyForm(wrapper)
    expect(currencyRows(wrapper)[1]).toContain('1 AMD = 0,2 RUB')

    // Дубликат: форма остаётся открытой, черновик не сброшен, отказ объяснён.
    await openCurrencyForm(wrapper)
    await wrapper.find('input[aria-label="Код валюты"]').setValue('AMD')
    await wrapper.find('input[aria-label="Код валюты"]').trigger('change')
    await wrapper.find('input[aria-label="Курс к базовой валюте"]').setValue('1')
    await submitCurrencyForm(wrapper)

    expect(wrapper.text()).toContain('«AMD» уже в поездке')
    expect(currencyRows(wrapper)).toHaveLength(2)
    expect(wrapper.find('input[aria-label="Курс к базовой валюте"]').exists()).toBe(true)
  })

  it('некорректный курс — тихая подсветка и неактивная кнопка; точка равнозначна запятой', async () => {
    const wrapper = await mountTripWith(['Аня'])
    await openCurrencyForm(wrapper)
    await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
    const rate = wrapper.find('input[aria-label="Курс к базовой валюте"]')
    const submit = () =>
      wrapper.findAll('button').find((b) => b.text() === 'Добавить валюту')!

    for (const bad of ['abc', '0', '-3', '1/2']) {
      await rate.setValue(bad)
      expect(submit().attributes('disabled')).toBeDefined()
    }

    await rate.setValue('0.85')
    expect(submit().attributes('disabled')).toBeUndefined()
    expect(norm(wrapper.text())).toContain('1 GEL = 0,85 RUB')
  })
})

describe('валюты: правка курса', () => {
  it('курс EUR 3 → 4: строка курса и эквивалент расхода меняются мгновенно', async () => {
    seedEuroTripWithExpense()
    const wrapper = await mountApp()

    expect(currencyRows(wrapper)[1]).toContain('1 EUR = 3 RUB')
    expect(norm(wrapper.text())).toContain('≈ 30,00 RUB')

    await wrapper.find('button[aria-label="Изменить курс EUR"]').trigger('click')
    await flush()
    const input = wrapper.find('input[aria-label="Новый курс EUR"]')
    expect((input.element as HTMLInputElement).value).toBe('3')

    await input.setValue('4')
    await wrapper.find('button[aria-label="Сохранить курс EUR"]').trigger('click')
    await flush()

    expect(currencyRows(wrapper)[1]).toContain('1 EUR = 4 RUB')
    expect(norm(wrapper.text())).toContain('≈ 40,00 RUB')
    expect(norm(wrapper.text())).not.toContain('≈ 30,00 RUB')
  })

  it('базовая валюта: бейдж «базовая», без правки курса и удаления', async () => {
    seedEuroTripWithExpense()
    const wrapper = await mountApp()

    expect(currencyRows(wrapper)[0]).toContain('RUB')
    expect(currencyRows(wrapper)[0]).toContain('базовая')
    expect(wrapper.find('button[aria-label="Изменить курс RUB"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Удалить валюту RUB"]').exists()).toBe(false)
  })
})

describe('валюты: удаление', () => {
  it('неиспользуемая валюта удаляется — строки и счётчик сходятся', async () => {
    const wrapper = await mountTripWith(['Аня'])
    await openCurrencyForm(wrapper)
    await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
    await wrapper.find('input[aria-label="Курс к базовой валюте"]').setValue('29,5')
    await submitCurrencyForm(wrapper)

    await wrapper.find('button[aria-label="Удалить валюту GEL"]').trigger('click')
    await flush()

    expect(currencyRows(wrapper)).toHaveLength(1)
    expect(norm(wrapper.text())).not.toContain('1 GEL = 29,5 RUB')
    expect(norm(wrapper.text())).toContain('1 из 10')
  })

  it('валюта в расходе не удаляется — понятный отказ', async () => {
    seedEuroTripWithExpense()
    const wrapper = await mountApp()

    await wrapper.find('button[aria-label="Удалить валюту EUR"]').trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Нельзя удалить «EUR»')
    expect(wrapper.text()).toContain('расходе')
    expect(currencyRows(wrapper)).toHaveLength(2)
  })
})

describe('валюты: лимит 10', () => {
  it('одиннадцатая валюта не добавляется — отказ с лимитом', async () => {
    const state: TripState = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    for (let i = 1; i <= 9; i++) {
      state.currencies.push({ code: `X${i}`, rate: { num: 1, den: 1 } })
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const wrapper = await mountApp()
    await openCurrencyForm(wrapper)
    await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
    await wrapper.find('input[aria-label="Курс к базовой валюте"]').setValue('29,5')
    await submitCurrencyForm(wrapper)

    expect(wrapper.text()).toContain('Лимит поездки — 10 валют, больше не добавить')
    expect(currencyRows(wrapper)).toHaveLength(10)
    expect(currencyRows(wrapper).join('\n')).not.toContain('GEL')
  })
})

describe('одновалютная поездка', () => {
  it('без захода в настройки: участники и расход в базовой валюте работают', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await wrapper.findAll('button').find((b) => b.text().includes('Добавить расход'))!.trigger('click')
    await flush()
    await wrapper.find('input[placeholder="Название расхода"]').setValue('Такси')
    await wrapper.find('input[aria-label="Сумма расхода"]').setValue('1500')
    await wrapper.findAll('form').find((f) => f.text().includes('Добавить расход'))!.trigger('submit')
    await flush()

    expect(currencyRows(wrapper)).toHaveLength(1)
    expect(currencyRows(wrapper)[0]).toContain('базовая')
    expect(norm(wrapper.text())).toContain('1 500,00 RUB')
    expect(norm(wrapper.text())).not.toContain('≈')
  })
})
