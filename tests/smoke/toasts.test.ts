import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { encodeTripState, SHARE_PAYLOAD_WARN } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import { ISO, mountApp, norm, seedTrip, seedWithZeroBalance } from '../helpers/smoke'

/**
 * Дымовые тесты тостов и полосы длины ссылки (тикет 17): сообщения-отказы и
 * подтверждения экрана поездки теперь тост в зоне видимости вместо абзаца внизу.
 * Гоняют только видимое пользователю через корневой App: роль и aria-live по тону
 * (error/warn — alert/assertive, info — status/polite), автоскрытие ~4 с, закрытие
 * тапом, предупреждение о длине ссылки до копирования и отсутствие дубля тоста у
 * квитанции — у неё локальная обратная связь на самой кнопке. Синглтоны стейта
 * сбрасываются реестром модулей: каждый тест — «чистая сессия» приложения
 * (конвенция trip-screens.test.ts).
 */

/** Подмена буфера: копирование уходит в стаб, а не в системный буфер (приём sharing.test.ts). */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

/** Поездка с Аней, занятой в расходе: удаление даёт отказ — материал для error-тоста. */
function seedBusyParticipant(): void {
  seedTrip((state) => {
    state.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
    state.expenses.push({
      id: 'e1',
      title: 'Такси',
      payerId: 'p1',
      amount: 1000,
      currencyCode: 'RUB',
      createdAt: ISO,
      split: { mode: 'equal', participantIds: ['p1'] },
    })
  })
}

/**
 * Кнопка-тост по роли внутри обёртки Toast.vue. Обёртка — единственный на экране
 * div с классами fixed + pointer-events-none (оверлей ConfirmDialog — fixed без
 * pointer-events-none), так что селектор не спутает тост с диалогом.
 */
function toast(wrapper: VueWrapper, role: 'alert' | 'status'): DOMWrapper<Element> {
  return wrapper.find(`div.fixed.pointer-events-none button[role="${role}"]`)
}

/** Кнопка тоста любым ролью — проверка «тоста вообще нет» и его закрытия. */
function anyToastButton(wrapper: VueWrapper): DOMWrapper<Element> {
  return wrapper.find('div.fixed.pointer-events-none button')
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: beforeunload гасит отложенный дебаунс-сейв синглтона
  // useTrip до очистки хранилища (подробное обоснование в trip-screens.test.ts).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('тост отказа (error)', () => {
  it('отказ удаления занятого участника виден сразу: alert/assertive вне потока main', async () => {
    seedBusyParticipant()
    const wrapper = await mountApp()

    // До отказа тоста нет: обёртка смонтирована всегда, кнопка в ней — нет.
    expect(anyToastButton(wrapper).exists()).toBe(false)

    await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
    await flush()

    const refusal = toast(wrapper, 'alert')
    expect(refusal.exists()).toBe(true)
    expect(refusal.attributes('aria-live')).toBe('assertive')
    expect(norm(refusal.text())).toContain('Нельзя удалить «Аня»')
    expect(norm(refusal.text())).toContain('расходе')

    // Тост живёт вне потока страницы: у кнопки приём кликов (pointer-events-auto),
    // сам тост не вложен в main — закреплён поверх контента, виден без скролла.
    expect(refusal.classes()).toContain('pointer-events-auto')
    expect(refusal.element.closest('main')).toBeNull()

    wrapper.unmount()
  })

  it('автоскрытие: на 3999-й миллисекунде тост ещё виден, после 4000 — исчез', async () => {
    vi.useFakeTimers()
    try {
      seedBusyParticipant()
      const wrapper = await mountApp()
      await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
      await flush()

      expect(toast(wrapper, 'alert').exists()).toBe(true)

      // Ещё не пора: 3999 мс из 4000.
      await vi.advanceTimersByTimeAsync(3999)
      expect(toast(wrapper, 'alert').exists()).toBe(true)

      // Порог пройден: dismiss сработал, тост ушёл (запас — на анимацию ухода).
      await vi.advanceTimersByTimeAsync(1000)
      await flush()
      expect(anyToastButton(wrapper).exists()).toBe(false)

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('тап по тосту закрывает его раньше автоскрытия', async () => {
    seedBusyParticipant()
    const wrapper = await mountApp()
    await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
    await flush()

    const shown = toast(wrapper, 'alert')
    expect(shown.exists()).toBe(true)
    await shown.trigger('click')
    await flush()

    expect(anyToastButton(wrapper).exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('тост info при копировании ссылки', () => {
  it('успешное копирование — роль status, polite, текст про отправку участникам', async () => {
    stubClipboard()
    seedWithZeroBalance()
    const wrapper = await mountApp()

    await wrapper
      .findAll('button')
      .find((b) => norm(b.text()).includes('Поделиться'))!
      .trigger('click')
    await flush()

    const info = toast(wrapper, 'status')
    expect(info.exists()).toBe(true)
    expect(info.attributes('aria-live')).toBe('polite')
    expect(norm(info.text())).toContain('Ссылка скопирована — отправьте её участникам')

    wrapper.unmount()
  })
})

describe('полоса длины ссылки', () => {
  it('несжимаемо длинная поездка: предупреждение с числом символов видно до копирования', async () => {
    // 60 000 случайных hex-символов в названии расхода: случайные данные
    // lz-string не сжимает (рецепт «несжимаемо длинная поездка» sharing.test.ts).
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(30_000)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    seedTrip((state) => {
      state.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
      state.expenses.push({
        id: 'e1',
        title: hex,
        payerId: 'p1',
        amount: 100000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ['p1'] },
      })
    })
    // Предусловие сценария: полезная нагрузка действительно длиннее порога.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as TripState
    const payloadLength = encodeTripState(stored).length
    expect(payloadLength).toBeGreaterThan(SHARE_PAYLOAD_WARN)

    const wrapper = await mountApp()

    // Полоса называет длину полной ссылки (префикс + payload) — до всякого тапа
    // «Поделиться». Число ищем в связке с текстом: голые цифры есть и в hex-названии.
    const linkLength =
      `${window.location.origin}${window.location.pathname}#/t=`.length + payloadLength
    expect(norm(wrapper.text())).toContain(
      `Ссылка на эту поездку длинная — ${linkLength} символов`,
    )

    wrapper.unmount()
  })

  it('у короткой поездки полосы нет', async () => {
    seedWithZeroBalance()
    const wrapper = await mountApp()

    expect(norm(wrapper.text())).not.toContain('Ссылка на эту поездку длинная')

    wrapper.unmount()
  })
})

describe('квитанция без дубля тоста', () => {
  it('копирование квитанции показывает только «Скопировано ✓» на кнопке — тоста нет', async () => {
    stubClipboard()
    seedWithZeroBalance()
    const wrapper = await mountApp()

    const button = wrapper
      .findAll('button')
      .find((b) => norm(b.text()) === 'Скопировать квитанцию')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flush()

    // Локальная обратная связь на самой квитанционной кнопке (у неё aria-live="polite").
    expect(norm(wrapper.text())).toContain('Скопировано ✓')

    // …и никакого тоста: ни alert, ни status, внутри fixed-обёртки кнопок нет.
    expect(toast(wrapper, 'alert').exists()).toBe(false)
    expect(toast(wrapper, 'status').exists()).toBe(false)
    expect(anyToastButton(wrapper).exists()).toBe(false)

    wrapper.unmount()
  })
})
