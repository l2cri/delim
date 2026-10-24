import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import { mountApp, norm, seedTrip, seedWithZeroBalance } from '../helpers/smoke'

/**
 * Дымовые тесты квитанции (тикет 14): предпросмотр на экране поездки и копирование
 * в буфер одним тапом с обратной связью «Скопировано». Гоняют только видимое
 * пользователю через корневой App; буфер подменяется стабом — тест проверяет
 * вызов и содержимое, а не сам системный буфер. Синглтоны стейта сбрасываются
 * реестром модулей (тот же паттерн, что в settlement.test.ts).
 */

/** Подмена буфера: копирование уходит в стаб, а не в системный буфер (общий
 *  приём обоих копирующих тестов, вынесен по P4 ревью #14). */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('предпросмотр квитанции', () => {
  it('карточка показывает текст с поездкой, балансами и переводами', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const preview = norm(wrapper.find('pre').text())
    expect(preview).toContain('Поездка: Кипр')
    expect(preview).toContain('Участники: Аня, Боря, Вика, Гоша')
    expect(preview).toContain('Расходов: 1 · Выплат: 0')
    expect(preview).toContain('Балансы · RUB')
    expect(preview).toContain('Аня — должны ему 666,66')
    expect(preview).toContain('Боря — должен 333,33')
    expect(preview).toContain('Переводы · RUB')
    expect(preview).toContain('Боря → Аня 333,33')
    // Моноширинный блок для мессенджера — фенсы входят и в предпросмотр, и в буфер.
    expect(preview).toContain('```')
  })

  it('пустая поездка — осмысленный текст вместо пустоты', async () => {
    seedTrip(() => {})
    const wrapper = await mountApp()

    const preview = norm(wrapper.find('pre').text())
    expect(preview).toContain('Поездка: Кипр')
    expect(preview).toContain('Участников и расходов пока нет.')
    expect(preview).not.toContain('```')
  })
})

describe('копирование в буфер', () => {
  it('тап копирует квитанцию целиком и кнопка отвечает «Скопировано»', async () => {
    const writeText = stubClipboard()
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const button = wrapper.findAll('button').find((b) => norm(b.text()) === 'Скопировать квитанцию')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flush()

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = norm(writeText.mock.calls[0][0] as string)
    expect(copied).toContain('Поездка: Кипр')
    expect(copied).toContain('Аня — должны ему 666,66')
    expect(copied).toContain('Вика → Аня 333,33')
    expect(norm(wrapper.text())).toContain('Скопировано')
  })

  it('квитанция живая: расход добавили — предпросмотр и буфер обновились', async () => {
    const writeText = stubClipboard()
    seedTrip((state) => {
      state.participants.push(
        { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
        { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
      )
    })
    const wrapper = await mountApp()
    expect(norm(wrapper.find('pre').text())).toContain('Переводов нет — все в нуле')

    // Расход через экран, как руками: 500,00 RUB поровну на двоих.
    await wrapper.findAll('button').find((b) => b.text().includes('Добавить расход'))!.trigger('click')
    await flush()
    await wrapper.find('input[placeholder="Название расхода"]').setValue('Такси')
    await wrapper.find('input[aria-label="Сумма расхода"]').setValue('5000')
    const form = wrapper
      .findAll('form')
      .find((f) => f.text().includes('Добавить расход') || f.text().includes('Сохранить расход'))
    await form!.trigger('submit')
    await flush()

    const button = wrapper
      .findAll('button')
      .find((b) => norm(b.text()) === 'Скопировать квитанцию')
    await button!.trigger('click')
    await flush()

    expect(norm(writeText.mock.calls[0][0] as string)).toContain('Расходов: 1 · Выплат: 0')
    // 5000,00 RUB поровну на двоих → Боря должен Ане 2500,00 (группы разрядов после norm).
    expect(norm(writeText.mock.calls[0][0] as string)).toContain('Боря → Аня 2 500,00')
  })
})
