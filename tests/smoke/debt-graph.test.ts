import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { computeBalances, createNewTrip, settle } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/**
 * Дымовые тесты карточки «Граф долгов» (тикет 13): круговая раскладка седения
 * поверх тех же операций ядра, что и экран сведения. Хелперы скопированы из
 * settlement.test.ts сознательно: общего tests/helpers/smoke.ts нет и не будет
 * (параллельная ветка #12), чтобы ветки не конфликтовали. Эталон числа дуг —
 * импорт ядра в самом тесте: граф показывает ровно то, что считает сечение.
 */
async function mountApp(): Promise<VueWrapper> {
  const { default: App } = await import('../../src/App.vue')
  return mount(App)
}

/** Формат сумм группирует разряды неразрывным пробелом — в ожиданиях это обычный пробел. */
function norm(text: string): string {
  return text.replace(/\u00A0/g, ' ')
}

/** Кладёт в хранилище свежую поездку «Кипр» (RUB) с довеской вызывающего теста;
 *  возвращает тот же стейт — эталон седения считается по нему. */
function seedTrip(mutate: (state: TripState) => void): TripState {
  const state = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  mutate(state)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  return state
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

/** Добавляет расход поровну между всеми: форма по умолчанию — режим «Поровну». */
async function addEqualExpense(
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

/** Ноды графа: группы участников с аватаром, именем и балансом. */
function graphNodes(wrapper: VueWrapper) {
  return wrapper.findAll('g.debt-node')
}

/** Дуги графа: группы переводов с aria-label направления. */
function graphArcs(wrapper: VueWrapper) {
  return wrapper.findAll('g.debt-arc')
}

/** Нода участника по имени (подпись ноды содержит имя). */
function nodeByName(wrapper: VueWrapper, name: string) {
  const node = graphNodes(wrapper).find((g) => norm(g.text()).includes(name))
  if (!node) throw new Error(`нода «${name}» не найдена`)
  return node
}

/** Позиция ноды из inline-стиля: координаты круговой раскладки (сортировка). */
function nodePos(wrapper: VueWrapper, name: string): { x: number; y: number } {
  const style = nodeByName(wrapper, name).attributes('style') ?? ''
  const m = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(style)
  if (!m) throw new Error(`нет translate в стиле ноды «${name}»: ${style}`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

/** aria-label дуги — направление перевода («Боря переводит Ане 333,33 RUB»). */
function arcLabel(arc: DOMWrapper<Element>): string {
  const label = arc.attributes('aria-label')
  if (!label) throw new Error('у дуги нет aria-label')
  return norm(label)
}

/** Поездка четырьмя участниками и расходом 1000,00 RUB (плательщица Аня, поровну
 * на троих) — балансы: Аня +666,66, Боря и Вика −333,33, Гоша — ноль
 * (тот же расклад, что в settlement.test.ts). */
function seedWithZeroBalance(): TripState {
  return seedTrip((state) => {
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

/** Поездка RUB + EUR (курс 3/1) с Аней и Борей и расходом 100,00 EUR поровну:
 * 300,00 RUB → Аня должна получить 150,00, Боря — отдать 150,00 (суммы дуг — в RUB). */
function seedEuroTrip(): TripState {
  return seedTrip((state) => {
    state.currencies.push({ code: 'EUR', rate: { num: 3, den: 1 } })
    state.participants.push(
      { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
      { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
    )
    state.expenses.push({
      id: 'e1',
      title: 'Ужин',
      payerId: 'p1',
      amount: 10000, // 100,00 EUR = 300,00 RUB по курсу 3/1
      currencyCode: 'EUR',
      createdAt: ISO,
      split: { mode: 'equal', participantIds: ['p1', 'p2'] },
    })
  })
}

/** 20 участников (лимит) с тремя расходами: у всех ненулевые балансы, сечение
 *  считает жадный слой (> 12 ненулевых — точный не запускается). */
function seedTwenty(): TripState {
  return seedTrip((state) => {
    const names = [
      'Аня',
      'Боря',
      'Вика',
      'Гоша',
      'Даша',
      'Егор',
      'Женя',
      'Зина',
      'Игорь',
      'Катя',
      'Лёва',
      'Маша',
      'Надя',
      'Олег',
      'Паша',
      'Рита',
      'Соня',
      'Тома',
      'Устин',
      'Фая',
    ]
    names.forEach((name, i) => {
      state.participants.push({
        id: `p${i + 1}`,
        name,
        color: i % 2 === 0 ? '#059669' : '#2563eb',
        emoji: i % 2 === 0 ? '🐻' : '🐧',
      })
    })
    const ids = names.map((_, i) => `p${i + 1}`)
    state.expenses.push(
      {
        id: 'e1',
        title: 'Дом',
        payerId: 'p1',
        amount: 200000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ids.slice(0, 10) },
      },
      {
        id: 'e2',
        title: 'Машина',
        payerId: 'p11',
        amount: 60000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ids.slice(10) },
      },
      {
        id: 'e3',
        title: 'Продукты',
        payerId: 'p5',
        amount: 150000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ids },
      },
    )
  })
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: закрытие гасит дебаунс-сейв синглтона useTrip
  // (тот же паттерн, что в settlement.test.ts по фиксу флакера автосейва).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
})

describe('ноды участников на окружности', () => {
  it('четыре участника: имена, эмодзи и тона балансов кредит/долг/ноль', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    expect(wrapper.find('svg[role="img"]').attributes('aria-label')).toBe('Граф долгов')
    expect(graphNodes(wrapper)).toHaveLength(4)
    expect(norm(nodeByName(wrapper, 'Аня').text())).toContain('🐻')
    expect(norm(nodeByName(wrapper, 'Боря').text())).toContain('🐧')
    expect(norm(nodeByName(wrapper, 'Вика').text())).toContain('🦊')
    expect(norm(nodeByName(wrapper, 'Гоша').text())).toContain('🐺')

    const anya = nodeByName(wrapper, 'Аня').find('text.debt-amount')
    expect(norm(anya.text())).toContain('666,66')
    expect(anya.classes().join(' ')).toContain('emerald')
    const borya = nodeByName(wrapper, 'Боря').find('text.debt-amount')
    expect(norm(borya.text())).toContain('333,33')
    expect(borya.classes().join(' ')).toContain('red')
    const vika = nodeByName(wrapper, 'Вика').find('text.debt-amount')
    expect(norm(vika.text())).toContain('333,33')
    expect(vika.classes().join(' ')).toContain('red')
    const gosha = nodeByName(wrapper, 'Гоша').find('text.debt-amount')
    expect(norm(gosha.text())).toContain('в нуле')
    expect(gosha.classes().join(' ')).toContain('zinc')
  })

  it('сортировка по балансу: кредитор сверху, нулевой за ним, должники замыкают круг', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const pos = {
      Аня: nodePos(wrapper, 'Аня'),
      Гоша: nodePos(wrapper, 'Гоша'),
      Боря: nodePos(wrapper, 'Боря'),
      Вика: nodePos(wrapper, 'Вика'),
    }
    // Порядок по убыванию баланса с 12 часов по часовой: Аня (+666,66) — верхушка,
    // Гоша (0) — справа, Боря и Вика (−333,33) — низ и лево.
    expect(pos.Аня.y).toBeLessThan(pos.Гоша.y)
    expect(pos.Гоша.x).toBeGreaterThan(pos.Аня.x)
    expect(pos.Боря.y).toBeGreaterThan(pos.Гоша.y)
    expect(pos.Вика.x).toBeLessThan(pos.Аня.x)
  })
})

describe('дуги переводов', () => {
  it('две дуги: суммы у середины, стрелка в группе, направление в aria-label', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const arcs = graphArcs(wrapper)
    expect(arcs).toHaveLength(2)
    const labels = arcs.map((arc) => arcLabel(arc)).sort()
    expect(labels).toEqual(['Боря переводит Ане 333,33 RUB', 'Вика переводит Ане 333,33 RUB'])
    for (const arc of arcs) {
      expect(norm(arc.find('text').text())).toContain('333,33')
      expect(arc.find('polygon').exists()).toBe(true)
    }
  })

  it('двое на EUR-расходе: две ноды, одна дуга, суммы в базовой валюте', async () => {
    seedEuroTrip()
    const wrapper = await mountApp()

    expect(graphNodes(wrapper)).toHaveLength(2)
    const arcs = graphArcs(wrapper)
    expect(arcs).toHaveLength(1)
    expect(arcLabel(arcs[0])).toBe('Боря переводит Ане 150,00 RUB')
    expect(norm(arcs[0].find('text').text())).toBe('150,00')
  })

  it('двадцать участников (лимит): число дуг равно сечению ядра, ничего не падает', async () => {
    const state = seedTwenty()
    const wrapper = await mountApp()

    expect(graphNodes(wrapper)).toHaveLength(20)
    const expected = settle(computeBalances(state)).length
    expect(expected).toBeGreaterThan(0)
    const arcs = graphArcs(wrapper)
    expect(arcs).toHaveLength(expected)
    for (const arc of arcs) {
      expect(arc.find('polygon').exists()).toBe(true)
    }
  })
})

describe('пустые состояния', () => {
  it('без участников — подсказка вместо графа', async () => {
    seedTrip(() => {})
    const wrapper = await mountApp()

    expect(wrapper.find('svg[role="img"]').exists()).toBe(false)
    expect(norm(wrapper.text())).toContain('Добавьте участников')
  })

  it('все в нуле — ноды есть, дуг нет, сообщение «Долгов нет»', async () => {
    seedTrip((state) => {
      state.participants.push(
        { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
        { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
      )
    })
    const wrapper = await mountApp()

    expect(graphNodes(wrapper)).toHaveLength(2)
    expect(graphArcs(wrapper)).toHaveLength(0)
    expect(norm(wrapper.text())).toContain('Долгов нет — все в нуле')
  })
})

describe('живой пересчёт', () => {
  it('расход добавил дугу, удаление расхода — погасило', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])
    expect(norm(wrapper.text())).toContain('Долгов нет — все в нуле')

    await addEqualExpense(wrapper, 'Аренда', '25000')
    const arcs = graphArcs(wrapper)
    expect(arcs).toHaveLength(1)
    expect(arcLabel(arcs[0])).toBe('Боря переводит Ане 12 500,00 RUB')
    expect(norm(arcs[0].find('text').text())).toBe('12 500,00')

    await wrapper.find('button[aria-label="Удалить расход Аренда"]').trigger('click')
    await flush()

    expect(graphArcs(wrapper)).toHaveLength(0)
    expect(norm(wrapper.text())).toContain('Долгов нет — все в нуле')
  })
})
