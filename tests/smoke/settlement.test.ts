import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import {
  ISO,
  addEqualExpense,
  balanceTexts,
  mountApp,
  mountTripWith,
  norm,
  seedTrip,
  seedWithZeroBalance,
  transferTexts,
} from '../helpers/smoke'

/**
 * Дымовые тесты экрана сведения (тикет 11): балансы участников и минимальные
 * переводы поверх операций ядра. Гоняют только то, что видит пользователь,
 * через корневой App; стейт готовится и через экраны, и сидированием хранилища
 * (расклад, который долго собирать кликами). Синглтоны стейта сбрасываются
 * реестром модулей: каждый тест — «чистая сессия» приложения. Общие хелперы —
 * в tests/helpers/smoke.ts.
 */

/** Поездка RUB + EUR (курс 3/1) с Аней и Борей и расходом 100,00 EUR поровну:
 * 300,00 RUB → Аня должна получить 150,00, Боря — отдать 150,00. */
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
      createdAt: ISO,
      split: { mode: 'equal', participantIds: ['p1', 'p2'] },
    })
  })
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: закрытие гасит дебаунс-сейв синглтона useTrip
  // (тот же паттерн, что в expenses.test.ts по фиксу флакера автосейва).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
})

describe('балансы участников', () => {
  it('со знаком и сортировкой по величине: кредитор сверху, должники за ним, нулевой в конце', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const rows = balanceTexts(wrapper)
    // Порядок строк и есть сортировка экрана: кредитор, должники, нулевой.
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain('Аня')
    expect(rows[1]).toContain('Боря')
    expect(rows[2]).toContain('Вика')
    expect(rows[3]).toContain('Гоша')
    expect(rows[0]).toContain('должны ему 666,66 RUB')
    expect(rows[1]).toContain('должен 333,33 RUB')
    expect(rows[2]).toContain('должен 333,33 RUB') // равные долги — в порядке участников
    expect(rows[3]).toContain('в нуле')
  })

  it('переводы соответствуют сечению ядра: должники гасят кредитора, нулевой не участвует', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const rows = transferTexts(wrapper)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Боря')
    expect(rows[0]).toContain('Аня')
    expect(rows[0]).toContain('333,33 RUB')
    expect(rows[1]).toContain('Вика')
    expect(rows[1]).toContain('Аня')
    expect(rows[1]).toContain('333,33 RUB')
  })

  it('все в нуле: списки пусты, переводы заменены пустым состоянием', async () => {
    seedTrip((state) => {
      state.participants.push(
        { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
        { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
      )
    })
    const wrapper = await mountApp()

    expect(balanceTexts(wrapper).every((r) => r.includes('в нуле'))).toBe(true)
    expect(wrapper.find('[aria-label="Список переводов"]').exists()).toBe(false)
    expect(norm(wrapper.text())).toContain('Переводов нет — все в нуле')
  })
})

describe('сведение живое: пересчёт на каждом изменении', () => {
  it('расход появился — перевод появился; расход удалён — переводы исчезли', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])
    expect(norm(wrapper.text())).toContain('Переводов нет — все в нуле')

    await addEqualExpense(wrapper, 'Аренда', '25000')
    expect(balanceTexts(wrapper)[0]).toContain('должны ему 12 500,00 RUB')
    expect(balanceTexts(wrapper)[1]).toContain('должен 12 500,00 RUB')
    const [transfer] = transferTexts(wrapper)
    expect(transfer).toContain('Боря')
    expect(transfer).toContain('Аня')
    expect(transfer).toContain('12 500,00 RUB')

    await wrapper.find('button[aria-label="Удалить расход Аренда"]').trigger('click')
    await flush()

    expect(wrapper.find('[aria-label="Список переводов"]').exists()).toBe(false)
    expect(norm(wrapper.text())).toContain('Переводов нет — все в нуле')
    expect(balanceTexts(wrapper).every((r) => r.includes('в нуле'))).toBe(true)
  })
})

describe('суммы — в базовой валюте поездки', () => {
  it('расход в EUR по курсу 3/1 — баланс и перевод в RUB с копейками', async () => {
    seedEuroTrip()
    const wrapper = await mountApp()

    expect(balanceTexts(wrapper)[0]).toContain('должны ему 150,00 RUB')
    expect(balanceTexts(wrapper)[1]).toContain('должен 150,00 RUB')
    expect(transferTexts(wrapper)[0]).toContain('150,00 RUB')
  })
})

describe('правка курса пересчитывает сведение', () => {
  it('курс EUR 3 → 5 в настройках валют — балансы и переводы стали вдвое больше', async () => {
    seedEuroTrip()
    const wrapper = await mountApp()
    expect(transferTexts(wrapper)[0]).toContain('150,00 RUB')

    await wrapper.find('button[aria-label="Изменить курс EUR"]').trigger('click')
    await flush()
    await wrapper.find('input[aria-label="Новый курс EUR"]').setValue('5')
    await wrapper.find('button[aria-label="Сохранить курс EUR"]').trigger('click')
    await flush()

    // 100,00 EUR × 5 = 500,00 RUB → по 250,00 каждой стороне.
    expect(balanceTexts(wrapper)[0]).toContain('должны ему 250,00 RUB')
    expect(balanceTexts(wrapper)[1]).toContain('должен 250,00 RUB')
    expect(transferTexts(wrapper)[0]).toContain('250,00 RUB')
  })
})
