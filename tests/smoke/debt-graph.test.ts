import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { computeBalances, parseTripState, settle } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import {
  addEqualExpense,
  mountApp,
  mountTripWith,
  norm,
  seedTrip,
  seedWithZeroBalance,
} from '../helpers/smoke'

/**
 * Дымовые тесты карточки «Граф долгов» (тикет 13): круговая раскладка седения
 * поверх тех же операций ядра, что и экран сведения. Общие хелперы — из
 * tests/helpers/smoke.ts (приехали с #12 при подтяжке master). Эталон числа
 * дуг — импорт ядра в самом тесте по стейту из хранилища: граф показывает
 * ровно то, что считает сведение.
 */

/** Стейт сидированной поездки — тот же, что загрузит приложение (публичный разбор). */
function storedTrip(): TripState {
  const parsed = parseTripState(localStorage.getItem(STORAGE_KEY)!)
  if (!parsed.ok) throw new Error('сид сломан')
  return parsed.state
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

/** Поездка RUB + EUR (курс 3/1) с Аней и Борей и расходом 100,00 EUR поровну:
 * 300,00 RUB → Аня должна получить 150,00, Боря — отдать 150,00 (суммы дуг — в RUB). */
function seedEuroTrip(): void {
  seedTrip((state) => {
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
      createdAt: '2026-10-01T10:00:00.000Z',
      split: { mode: 'equal', participantIds: ['p1', 'p2'] },
    })
  })
}

/** 20 участников (лимит) с тремя расходами: у всех ненулевые балансы, сведение
 *  считает жадный слой (> 12 ненулевых — точный не запускается). */
function seedTwenty(): void {
  seedTrip((state) => {
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
    const createdAt = '2026-10-01T10:00:00.000Z'
    state.expenses.push(
      {
        id: 'e1',
        title: 'Дом',
        payerId: 'p1',
        amount: 200000,
        currencyCode: 'RUB',
        createdAt,
        split: { mode: 'equal', participantIds: ids.slice(0, 10) },
      },
      {
        id: 'e2',
        title: 'Машина',
        payerId: 'p11',
        amount: 60000,
        currencyCode: 'RUB',
        createdAt,
        split: { mode: 'equal', participantIds: ids.slice(10) },
      },
      {
        id: 'e3',
        title: 'Продукты',
        payerId: 'p5',
        amount: 150000,
        currencyCode: 'RUB',
        createdAt,
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
    seedTwenty()
    const wrapper = await mountApp()

    expect(graphNodes(wrapper)).toHaveLength(20)
    const expected = settle(computeBalances(storedTrip())).length
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
