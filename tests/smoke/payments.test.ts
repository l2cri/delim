import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import {
  balanceTexts,
  mountApp,
  norm,
  seedWithZeroBalance,
  transferTexts,
} from '../helpers/smoke'

/**
 * Дымовые тесты выплат (тикет 12): регистрация «кто→кому сколько» формой,
 * мгновенный пересчёт седения и свободные правка/удаление (ADR 0010). Гоняют
 * только то, что видит пользователь, через корневой App. Сцена сидируется в
 * хранилище: расход 1000,00 платит Аня поровну на троих — Аня +666,66,
 * Боря и Вика должны по 333,33, Гоша в нуле. Выплаты вводятся формой, как руками.
 */

/** Строки выплат — нормированные тексты по порядку списка. */
function paymentTexts(wrapper: VueWrapper): string[] {
  return wrapper
    .find('[aria-label="Список выплат"]')
    .findAll('li')
    .map((li) => norm(li.text()))
}

/** Открывает форму «+ Добавить выплату» и проводит выплату: стороны по id,
 * сумма строкой, как её вводит пользователь (парсит ядро через AmountInput). */
async function addPaymentViaForm(
  wrapper: VueWrapper,
  fromId: string,
  toId: string,
  amount: string,
): Promise<void> {
  await wrapper.findAll('button').find((b) => b.text().includes('Добавить выплату'))!.trigger('click')
  await flush()
  await wrapper.find('select[aria-label="Кто платит"]').setValue(fromId)
  await wrapper.find('select[aria-label="Кому"]').setValue(toId)
  await wrapper.find('input[aria-label="Сумма выплаты"]').setValue(amount)
  const form = wrapper
    .findAll('form')
    .find((f) => f.text().includes('Добавить выплату') || f.text().includes('Сохранить выплату'))
  if (!form) throw new Error('форма выплаты не открыта')
  await form.trigger('submit')
  await flush()
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

describe('выплата гасит перевод', () => {
  it('полная выплата должника убирает его перевод; выплата видна в списке', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await addPaymentViaForm(wrapper, 'p2', 'p1', '333,33')

    // Перевод Боря→Аня исчез, остался один Вика→Аня 333,33.
    const transfers = transferTexts(wrapper)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toContain('Вика')
    expect(transfers[0]).toContain('Аня')
    expect(transfers[0]).toContain('333,33 RUB')

    const payments = paymentTexts(wrapper)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toContain('Боря')
    expect(payments[0]).toContain('Аня')
    expect(payments[0]).toContain('333,33 RUB')
  })

  it('частичная выплата уменьшает остаточный перевод и баланс кредитора', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await addPaymentViaForm(wrapper, 'p2', 'p1', '100') // 100,00 из 333,33

    const transfers = transferTexts(wrapper)
    expect(transfers).toHaveLength(2)
    const borisTransfer = transfers.find((row) => row.includes('Боря'))
    expect(borisTransfer).toContain('233,33 RUB')
    expect(borisTransfer).toContain('Аня')
    const anyaBalance = balanceTexts(wrapper).find((row) => row.includes('Аня'))
    expect(anyaBalance).toContain('должны ему 566,66 RUB')
  })

  it('полные выплаты обоих должников: переводов нет, все балансы в нуле', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await addPaymentViaForm(wrapper, 'p2', 'p1', '333,33')
    await addPaymentViaForm(wrapper, 'p3', 'p1', '333,33')

    // Список переводов заменён пустым состоянием.
    expect(wrapper.find('[aria-label="Список переводов"]').exists()).toBe(false)
    expect(norm(wrapper.text())).toContain('Переводов нет — все в нуле')
    expect(balanceTexts(wrapper).every((row) => row.includes('в нуле'))).toBe(true)
  })
})

describe('правка и удаление выплаты откатывают её эффект', () => {
  it('редактирование суммы 100,00 → 200,00 меняет остаточный перевод на 133,33', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()
    await addPaymentViaForm(wrapper, 'p2', 'p1', '100')
    expect(transferTexts(wrapper).find((row) => row.includes('Боря'))).toContain('233,33 RUB')

    await wrapper.find('button[aria-label="Изменить выплату Боря → Аня"]').trigger('click')
    await flush()
    await wrapper.find('input[aria-label="Сумма выплаты"]').setValue('200')
    const form = wrapper.findAll('form').find((f) => f.text().includes('Сохранить выплату'))
    if (!form) throw new Error('форма редактирования выплаты не открыта')
    await form.trigger('submit')
    await flush()

    expect(transferTexts(wrapper).find((row) => row.includes('Боря'))).toContain('133,33 RUB')
  })

  it('удаление выплаты возвращает перевод к прежней сумме', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()
    await addPaymentViaForm(wrapper, 'p2', 'p1', '100')
    expect(transferTexts(wrapper).find((row) => row.includes('Боря'))).toContain('233,33 RUB')

    await wrapper.find('button[aria-label="Удалить выплату Боря → Аня"]').trigger('click')
    await flush()

    expect(transferTexts(wrapper).find((row) => row.includes('Боря'))).toContain('333,33 RUB')
    // Список выплат заменён пустым состоянием.
    expect(wrapper.find('[aria-label="Список выплат"]').exists()).toBe(false)
    expect(norm(wrapper.text())).toContain('Пока выплат нет')
  })
})

describe('форма выплаты', () => {
  it('совпадающие «кто» и «кому» блокируют сохранение', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await wrapper.findAll('button').find((b) => b.text().includes('Добавить выплату'))!.trigger('click')
    await flush()
    await wrapper.find('select[aria-label="Кто платит"]').setValue('p2')
    await wrapper.find('select[aria-label="Кому"]').setValue('p2')
    await wrapper.find('input[aria-label="Сумма выплаты"]').setValue('333,33')

    const form = wrapper.findAll('form').find((f) => f.text().includes('Добавить выплату'))
    if (!form) throw new Error('форма выплаты не открыта')
    expect(form.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
})

describe('суммы выплат — в базовой валюте с копейками', () => {
  it('выплата 1000,00 показывается в списке с группировкой разрядов', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await addPaymentViaForm(wrapper, 'p2', 'p1', '1000')

    expect(paymentTexts(wrapper)).toHaveLength(1)
    expect(paymentTexts(wrapper)[0]).toContain('1 000,00 RUB')
  })
})
