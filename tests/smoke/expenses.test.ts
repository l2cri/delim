import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { createNewTrip, parseTripState } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/**
 * Дымовые тесты экрана расходов (qa-acceptance): гоняют только то, что видит
 * пользователь, через корневой App — создание поездки, участники, форма расхода
 * (три режима сплита) и список. Синглтоны стейта сбрасываются реестром модулей:
 * каждый тест — «чистая сессия» приложения.
 */
async function mountApp(): Promise<VueWrapper> {
  const { default: App } = await import('../../src/App.vue')
  return mount(App)
}

/** Формат сумм группирует разряды неразрывным пробелом — в ожиданиях это обычный пробел. */
function norm(text: string): string {
  return text.replace(/\u00A0/g, ' ')
}

async function addParticipant(wrapper: VueWrapper, name: string): Promise<void> {
  // happy-dom не поднимает submit по клику кнопки — триггерим форму, как браузер.
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

/** Открывает форму добавления расхода кнопкой «+ Добавить расход». */
async function openExpenseForm(wrapper: VueWrapper): Promise<void> {
  await wrapper.findAll('button').find((b) => b.text().includes('Добавить расход'))!.trigger('click')
  await flush()
}

/** Форма расхода: на экране их две (участники и расходы) — узнаём по кнопке submit. */
function expenseForm(wrapper: VueWrapper): DOMWrapper<Element> {
  const form = wrapper
    .findAll('form')
    .find((f) => f.text().includes('Добавить расход') || f.text().includes('Сохранить расход'))
  if (!form) throw new Error('форма расхода не открыта')
  return form
}

/** Кнопка submit формы расхода (текст зависит от режима добавления/редактирования). */
function submitButton(wrapper: VueWrapper): DOMWrapper<Element> {
  const button = expenseForm(wrapper)
    .findAll('button')
    .find((b) => b.text() === 'Добавить расход' || b.text() === 'Сохранить расход')
  if (!button) throw new Error('кнопка сохранения расхода не найдена')
  return button
}

async function saveExpenseForm(wrapper: VueWrapper): Promise<void> {
  await expenseForm(wrapper).trigger('submit')
  await flush()
}

/** Клик по табу режима сплита («Поровну» / «Точными суммами» / «Долями»). */
async function clickTab(wrapper: VueWrapper, label: string): Promise<void> {
  await wrapper.findAll('button').find((b) => b.text() === label)!.trigger('click')
  await flush()
}

/** Заполняет форму расхода названием и суммой; режим и доли — дело конкретного теста. */
async function fillExpenseBasics(
  wrapper: VueWrapper,
  title: string,
  amount: string,
): Promise<void> {
  await wrapper.find('input[placeholder="Название расхода"]').setValue(title)
  await wrapper.find('input[aria-label="Сумма расхода"]').setValue(amount)
}

/**
 * Элементы списка расходов — нормированные тексты по порядку. Список живёт в
 * TransitionGroup, который @vue/test-utils по умолчанию стабит (тег теряется) —
 * поэтому ищем контейнер по aria-label, без тега.
 */
function expenseTexts(wrapper: VueWrapper): string[] {
  return wrapper
    .find('[aria-label="Список расходов"]')
    .findAll('li')
    .map((li) => norm(li.text()))
}

/** Строки участников в форме расхода — нормированные тексты по порядку участников. */
function splitRowTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('ul[aria-label="Участники сплита"] li').map((li) => norm(li.text()))
}

/** Кладёт в хранилище поездку RUB + EUR (курс 3/1) с Аней и Борей; стейт — для досидирования. */
function seedEuroTrip(): TripState {
  const state: TripState = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  state.currencies.push({ code: 'EUR', rate: { num: 3, den: 1 } })
  state.participants.push(
    { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
    { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return state
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: она не только открылась, но и закрылась. beforeunload
  // заставляет синглтон useTrip погасить отложенный дебаунс-сейв (тот же
  // паттерн, что в trip-screens.test.ts по фиксу флакера автосейва).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
})

describe('расходы: сохранение в трёх режимах сплита', () => {
  it('поровну: двое и 1500 — расход в списке с названием, плательщиком и суммой', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Такси', '1500')
    expect(norm(wrapper.text())).toContain('Распределено ровно 1 500,00')

    await saveExpenseForm(wrapper)

    const [first] = expenseTexts(wrapper)
    expect(first).toContain('Такси')
    expect(first).toContain('Аня') // плательщик по умолчанию — первый участник
    expect(first).toContain('1 500,00 RUB')
    expect(norm(wrapper.text())).toContain('1 из 300')
  })

  it('точными суммами: 1000 = 600 + 400 сходится и сохраняется', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Ужин', '1000')
    await clickTab(wrapper, 'Точными суммами')
    // Автоподстановка поровну (500/500) правится под фактические траты.
    await wrapper.find('input[aria-label="Сумма доли Аня"]').setValue('600')
    await wrapper.find('input[aria-label="Сумма доли Боря"]').setValue('400')
    expect(norm(wrapper.text())).toContain('Распределено ровно 1 000,00')

    // Плательщик — не первый участник, а выбранный вручную.
    const payer = wrapper.find('select[aria-label="Плательщик"]')
    const boris = payer.findAll('option').find((o) => o.text() === 'Боря')!
    await payer.setValue((boris.element as HTMLOptionElement).value)

    await saveExpenseForm(wrapper)

    const [first] = expenseTexts(wrapper)
    expect(first).toContain('Ужин')
    expect(first).toContain('Боря')
    expect(first).toContain('1 000,00 RUB')
  })

  it('долями: веса 2/1/1 от 2000 — превью 1000/500/500 и сохранение', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря', 'Вика'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Продукты', '2000')
    await clickTab(wrapper, 'Долями')
    await wrapper.find('input[aria-label="Доля Аня"]').setValue('2')
    const rows = splitRowTexts(wrapper)
    expect(rows[0]).toContain('1 000,00')
    expect(rows[1]).toContain('500,00')
    expect(rows[2]).toContain('500,00')

    await saveExpenseForm(wrapper)

    const [first] = expenseTexts(wrapper)
    expect(first).toContain('Продукты')
    expect(first).toContain('2 000,00 RUB')
  })
})

describe('калькулятор суммы в расходе', () => {
  it('выражение «1500/4+200»: предпросмотр «→ 575,00» до сохранения и 575,00 в списке', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await wrapper.find('input[placeholder="Название расхода"]').setValue('Ужин')
    await wrapper.find('input[aria-label="Сумма расхода"]').setValue('1500/4+200')
    expect(wrapper.text()).toContain('→ 575,00')

    await saveExpenseForm(wrapper)

    expect(expenseTexts(wrapper)[0]).toContain('575,00 RUB')
  })
})

describe('переключение режимов не теряет данные', () => {
  it('точные суммы → доли → точные суммы → поровну: черновики на месте, сохранение проходит', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря', 'Вика'])
    const exactOf = (name: string): HTMLInputElement =>
      wrapper.find(`input[aria-label="Сумма доли ${name}"]`).element as HTMLInputElement

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Кафе', '100')

    // В «Точными суммами» выбранным без суммы подставляется поровну-доля.
    await clickTab(wrapper, 'Точными суммами')
    expect(exactOf('Аня').value).toBe('33,34')
    expect(exactOf('Боря').value).toBe('33,33')
    expect(exactOf('Вика').value).toBe('33,33')

    await clickTab(wrapper, 'Долями')
    expect(
      wrapper.findAll('button').find((b) => b.text() === 'Долями')!.attributes('aria-pressed'),
    ).toBe('true')
    await wrapper.find('input[aria-label="Доля Аня"]').setValue('2')
    const rows = splitRowTexts(wrapper)
    expect(rows[0]).toContain('50,00')
    expect(rows[1]).toContain('25,00')
    expect(rows[2]).toContain('25,00')

    // Назад в точные: подсчитанные раньше суммы не перезатёрты.
    await clickTab(wrapper, 'Точными суммами')
    expect(exactOf('Аня').value).toBe('33,34')
    expect(exactOf('Боря').value).toBe('33,33')
    expect(exactOf('Вика').value).toBe('33,33')

    await clickTab(wrapper, 'Поровну')
    await saveExpenseForm(wrapper)

    expect(expenseTexts(wrapper)[0]).toContain('100,00 RUB')
  })
})

describe('несходящийся точный сплит не сохраняется', () => {
  it('40+50 и 60+50 против 100 блокируют сохранение расхождением, 50+50 — сохраняется', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Такси', '100')
    await clickTab(wrapper, 'Точными суммами')
    const anya = wrapper.find('input[aria-label="Сумма доли Аня"]')

    // Вторая доля остаётся 50 из автоподстановки.
    await anya.setValue('40')
    expect(norm(wrapper.text())).toContain('не хватает 10,00')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await anya.setValue('60')
    expect(norm(wrapper.text())).toContain('лишние 10,00')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await anya.setValue('50')
    expect(norm(wrapper.text())).toContain('Распределено ровно 100,00')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()

    await saveExpenseForm(wrapper)
    expect(expenseTexts(wrapper)[0]).toContain('100,00 RUB')
  })
})

describe('поровну с копейками', () => {
  it('100 на троих — превью строк 33,34 / 33,33 / 33,33 (остаток — первому)', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря', 'Вика'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Кофе', '100')

    const rows = splitRowTexts(wrapper)
    expect(rows[0]).toContain('33,34')
    expect(rows[1]).toContain('33,33')
    expect(rows[2]).toContain('33,33')
    expect(norm(wrapper.text())).toContain('Распределено ровно 100,00')
  })
})

describe('эквивалент в базовой валюте', () => {
  it('расход в EUR по курсу 3/1 — «≈ 30,00 RUB» под суммой и в списке', async () => {
    seedEuroTrip()
    const wrapper = await mountApp()

    await openExpenseForm(wrapper)
    await wrapper.find('select[aria-label="Валюта расхода"]').setValue('EUR')
    await wrapper.find('input[placeholder="Название расхода"]').setValue('Ужин')
    await wrapper.find('input[aria-label="Сумма расхода"]').setValue('10')
    expect(norm(wrapper.text())).toContain('≈ 30,00 RUB')

    await saveExpenseForm(wrapper)

    const [first] = expenseTexts(wrapper)
    expect(first).toContain('10,00 EUR')
    expect(first).toContain('≈ 30,00 RUB')
  })
})

describe('редактирование и удаление расхода', () => {
  it('изменение: поля префиллены, новая сумма и пересчитанный эквивалент в списке', async () => {
    const state = seedEuroTrip()
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

    const wrapper = await mountApp()
    await wrapper.find('button[aria-label="Изменить расход Ужин"]').trigger('click')
    await flush()

    expect(expenseForm(wrapper).text()).toContain('Сохранить расход')
    expect(
      (wrapper.find('input[placeholder="Название расхода"]').element as HTMLInputElement).value,
    ).toBe('Ужин')
    expect(
      (wrapper.find('input[aria-label="Сумма расхода"]').element as HTMLInputElement).value,
    ).toBe('10,00')

    await wrapper.find('input[aria-label="Сумма расхода"]').setValue('20')
    expect(norm(wrapper.text())).toContain('≈ 60,00 RUB')

    await saveExpenseForm(wrapper)

    const [first] = expenseTexts(wrapper)
    expect(first).toContain('20,00 EUR')
    expect(first).toContain('≈ 60,00 RUB')
    expect(first).not.toContain('10,00 EUR')
    expect(norm(wrapper.text())).toContain('1 из 300') // обновление, а не вторая запись
  })

  it('удаление: расход исчезает из списка, счётчик уменьшается', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Такси', '1500')
    await saveExpenseForm(wrapper)
    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Ужин', '1000')
    await saveExpenseForm(wrapper)
    expect(norm(wrapper.text())).toContain('2 из 300')

    await wrapper.find('button[aria-label="Удалить расход Такси"]').trigger('click')
    await flush()

    expect(expenseTexts(wrapper)).toHaveLength(1)
    expect(expenseTexts(wrapper)[0]).toContain('Ужин')
    expect(norm(wrapper.text())).not.toContain('Такси')
    expect(norm(wrapper.text())).toContain('1 из 300')
  })
})

describe('автосохранение расхода', () => {
  it('после перезагрузки страницы расход на месте', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountTripWith(['Аня', 'Боря'])
      await openExpenseForm(wrapper)
      await fillExpenseBasics(wrapper, 'Такси', '1500')
      await saveExpenseForm(wrapper)

      // Дебаунс автосейва истёк, вкладка «закрыта и открыта заново».
      await vi.advanceTimersByTimeAsync(600)

      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      const parsed = parseTripState(raw as string)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.state.expenses.map((e) => e.title)).toEqual(['Такси'])

      vi.resetModules()
      const reloaded = await mountApp()
      expect(norm(reloaded.text())).toContain('Такси')
      expect(norm(reloaded.text())).toContain('1 500,00 RUB')
      expect(norm(reloaded.text())).toContain('1 из 300')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('связка расход—участник', () => {
  it('плательщика расхода нельзя удалить — понятный отказ', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])

    await openExpenseForm(wrapper)
    await fillExpenseBasics(wrapper, 'Такси', '1500')
    await saveExpenseForm(wrapper)

    // Аня — плательщик по умолчанию (первый участник).
    await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Нельзя удалить «Аня»')
    expect(wrapper.text()).toContain('расходе')
    expect(wrapper.text()).toContain('Аня') // участник никуда не делся
  })
})
