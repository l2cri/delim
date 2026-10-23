import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createNewTrip, parseTripState } from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/**
 * Дымовые тесты экранов создания поездки и участников (qa-acceptance):
 * гоняют только то, что видит пользователь, через корневой App. Синглтоны стейта
 * сбрасываются реестром модулей: каждый тест — «чистая сессия» приложения.
 */
async function mountApp(): Promise<VueWrapper> {
  const { default: App } = await import('../../src/App.vue')
  return mount(App)
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

describe('создание поездки', () => {
  it('без сохранённой поездки — экран создания с пресетом валют', async () => {
    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Новая поездка')
    expect(wrapper.text()).toContain('RUB')
    expect(wrapper.text()).toContain('GEL')
    expect(wrapper.text()).toContain('Создать поездку')
  })

  it('заполнение формы создаёт поездку — экран с названием, валютой и пустым списком', async () => {
    const wrapper = await mountApp()

    await wrapper.find('#trip-name').setValue('  Грузия-2026  ')
    await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Грузия-2026')
    expect(wrapper.text()).toContain('Базовая валюта: GEL')
    expect(wrapper.text()).toContain('Пока никого нет')
  })

  it('кнопка создания неактивна, пока нет названия или валюты', async () => {
    const wrapper = await mountApp()

    const create = wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!
    expect(create.attributes('disabled')).toBeDefined()

    await wrapper.find('#trip-name').setValue('Кипр')
    expect(create.attributes('disabled')).toBeDefined()
  })

  it('Enter в названии создаёт поездку, коммитя черновик своей валюты без блура', async () => {
    const wrapper = await mountApp()

    await wrapper.find('#trip-name').setValue('Кипр')
    await wrapper.find('input[placeholder="Своя валюта, код"]').setValue('amd')
    await wrapper.find('#trip-name').trigger('keyup.enter')
    await flush()

    expect(wrapper.text()).toContain('Базовая валюта: AMD')
  })
})

describe('участники на экране поездки', () => {
  async function mountFreshTrip(): Promise<VueWrapper> {
    const wrapper = await mountApp()
    await wrapper.find('#trip-name').setValue('Кипр')
    await wrapper.findAll('button').find((b) => b.text().includes('RUB'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
    await flush()
    return wrapper
  }

  async function addParticipant(wrapper: VueWrapper, name: string): Promise<void> {
    // happy-dom не поднимает submit по клику кнопки — триггерим форму, как браузер.
    await wrapper.find('input[placeholder="Имя участника"]').setValue(name)
    await wrapper.find('form').trigger('submit')
    await flush()
  }

  it('добавление участника показывает его в списке, счётчик растёт', async () => {
    const wrapper = await mountFreshTrip()

    await addParticipant(wrapper, 'Аня')
    await addParticipant(wrapper, 'Боря')

    expect(wrapper.text()).toContain('Аня')
    expect(wrapper.text()).toContain('Боря')
    expect(wrapper.text()).toContain('2 из 20')
  })

  it('переименование сразу отражается в списке', async () => {
    const wrapper = await mountFreshTrip()
    await addParticipant(wrapper, 'Аня')

    await wrapper.find('button[aria-label^="Переименовать участника"]').trigger('click')
    await wrapper.find('input[aria-label="Новое имя участника"]').setValue('Анюта')
    await wrapper.find('button[aria-label="Сохранить имя"]').trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Анюта')
    expect(wrapper.text()).not.toContain('Аня')
  })

  it('перегенерация меняет цвет аватара участника', async () => {
    const wrapper = await mountFreshTrip()
    await addParticipant(wrapper, 'Аня')

    const avatar = wrapper.find('li span')
    const before = (avatar.element as HTMLElement).style.backgroundColor
    await wrapper.find('button[aria-label^="Перегенерировать аватар"]').trigger('click')
    await flush()

    expect((avatar.element as HTMLElement).style.backgroundColor).not.toBe(before)
    expect(wrapper.text()).toContain('Аня')
  })

  it('свободный участник удаляется', async () => {
    const wrapper = await mountFreshTrip()
    await addParticipant(wrapper, 'Аня')
    await addParticipant(wrapper, 'Боря')

    await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
    await flush()

    expect(wrapper.text()).not.toContain('Аня')
    expect(wrapper.text()).toContain('Боря')
  })

  it('двадцать первый участник не добавляется — лимит объяснён сообщением', async () => {
    const wrapper = await mountFreshTrip()

    for (let i = 1; i <= 20; i++) {
      await addParticipant(wrapper, `Участник ${i}`)
    }
    expect(wrapper.text()).toContain('20 из 20')

    await addParticipant(wrapper, 'Двадцать первый')

    expect(wrapper.text()).toContain('Лимит поездки — 20 участников')
    expect(wrapper.text()).not.toContain('Двадцать первый')
  })

  it('занятый в расходе участник не удаляется — понятный отказ', async () => {
    const state: TripState = createNewTrip({ name: 'Кипр', baseCurrency: 'RUB' })
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Аня')
    await wrapper.find('button[aria-label="Удалить участника Аня"]').trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Нельзя удалить «Аня»')
    expect(wrapper.text()).toContain('расходе')
    expect(wrapper.text()).toContain('Аня')
  })
})

describe('автосохранение и перезагрузка', () => {
  it('после перезагрузки страницы поездка и участники на месте', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountApp()
      await wrapper.find('#trip-name').setValue('Грузия')
      await wrapper.findAll('button').find((b) => b.text().includes('GEL'))!.trigger('click')
      await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
      await flush()
      await wrapper.find('input[placeholder="Имя участника"]').setValue('Аня')
      await wrapper.find('form').trigger('submit')
      await flush()

      // Дебаунс автосейва истёк, вкладка «закрыта и открыта заново».
      await vi.advanceTimersByTimeAsync(600)

      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      expect(parseTripState(raw as string).ok).toBe(true)

      vi.resetModules()
      const reloaded = await mountApp()
      expect(reloaded.text()).toContain('Грузия')
      expect(reloaded.text()).toContain('Аня')
    } finally {
      vi.useRealTimers()
    }
  })
})
