import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import { createNewTrip, parseTripState } from '../../src/core'
import type { TripState } from '../../src/core'
import { ARCHIVE_STORAGE_KEY, STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import { addEqualExpense, ISO, mountApp, mountTripWith, norm, seedTrip } from '../helpers/smoke'

/**
 * Дымовые тесты архивного цикла (тикет 16): завершение, удаление, замена архива
 * и экран #/archive — всё через корневой App, «как руками». Синглтоны стейта
 * сбрасываются реестром модулей: каждый тест — «чистая сессия» приложения
 * (конвенция trip-screens.test.ts, в т.ч. beforeunload в afterEach).
 */

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: beforeunload гасит отложенный дебаунс-сейв синглтона
  // useTrip — подробное обоснование в trip-screens.test.ts; clear уже после него.
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
})

/** Навигация «как руками»: сменить хэш и разбудить роутер (hashchange). */
async function go(hash: string): Promise<void> {
  window.location.hash = hash
  window.dispatchEvent(new Event('hashchange'))
  await flush()
}

/** Кладёт завершённую поездку «Рим» (EUR) в архивный ключ — то, что делает finishTrip. */
function seedArchive(mutate: (state: TripState) => void = () => {}): void {
  const state = createNewTrip({ name: 'Рим', baseCurrency: 'EUR' })
  mutate(state)
  state.status = 'completed'
  localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(state))
}

/** Единственный подтверждённый диалог — по role="dialog" (ConfirmDialog). */
function dialog(wrapper: VueWrapper) {
  return wrapper.find('[role="dialog"]')
}

/** Текст экрана архива: экран активной поездки/создания остаётся смонтированным
 *  под v-show — его скрытый текст не должен попадать в утверждения об архиве. */
function archiveText(wrapper: VueWrapper): string {
  const chip = wrapper.findAll('span').find((s) => norm(s.text()) === 'Архив · только чтение')
  if (!chip) throw new Error('экран архива не найден')
  // Чип лежит в хедере архива — ближайший корень .min-h-dvh и есть его экран.
  return norm(chip.element.closest('.min-h-dvh')?.textContent ?? '')
}

describe('завершение поездки с данными', () => {
  it('уводит поездку в архив, #/ предлагает новую, архив только для чтения', async () => {
    const wrapper = await mountTripWith(['Аня', 'Боря'])
    await addEqualExpense(wrapper, 'Ужин', '100')

    await wrapper.findAll('button').find((b) => b.text() === 'Завершить поездку')!.trigger('click')
    await flush()

    const finishDialog = dialog(wrapper)
    expect(finishDialog.exists()).toBe(true)
    expect(norm(finishDialog.text())).toContain('уйдёт в архив')
    expect(norm(finishDialog.text())).toContain('Кипр')

    await finishDialog.findAll('button').find((b) => b.text() === 'Завершить')!.trigger('click')
    await flush()

    // #/ снова предлагает создать новую; баннер напоминает, что архив занят.
    expect(wrapper.text()).toContain('Новая поездка')
    expect(norm(wrapper.text())).toContain('В архиве — поездка «Кипр»')

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    const rawArchive = localStorage.getItem(ARCHIVE_STORAGE_KEY)
    expect(rawArchive).not.toBeNull()
    const parsed = parseTripState(rawArchive as string)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.state.name).toBe('Кипр')
      expect(parsed.state.status).toBe('completed')
    }

    await wrapper.findAll('button').find((b) => b.text() === 'Открыть архив')!.trigger('click')
    await go('#/archive')

    const text = archiveText(wrapper)
    expect(text).toContain('Архив · только чтение')
    expect(text).toContain('Кипр')
    expect(text).toContain('Аня')
    expect(text).toContain('Боря')
    expect(text).toContain('50,00')
    expect(text).toContain('Квитанция')
    // Только чтение: ни форм, ни кнопок изменения — их нет даже скрытыми внутри архива.
    expect(text).not.toContain('Добавить расход')
    expect(text).not.toContain('Добавить выплату')
    expect(text).not.toContain('Имя участника')
    expect(text).not.toContain('Изменить')
    expect(text).not.toContain('Удалить')
  })

  it('после перезагрузки страницы архив на месте (критерий 7)', async () => {
    const wrapper = await mountTripWith(['Аня'])
    await addEqualExpense(wrapper, 'Ужин', '100')
    await wrapper.findAll('button').find((b) => b.text() === 'Завершить поездку')!.trigger('click')
    await flush()
    await dialog(wrapper).findAll('button').find((b) => b.text() === 'Завершить')!.trigger('click')
    await flush()

    // Вкладка «закрыта и открыта заново»: новый экземпляр приложения читает хранилище.
    vi.resetModules()
    const reloaded = await mountApp()
    expect(norm(reloaded.text())).toContain('В архиве — поездка «Кипр»')

    await go('#/archive')
    expect(archiveText(reloaded)).toContain('Кипр')
  })
})

describe('удаление поездки', () => {
  it('пустая поездка при «Завершить» предлагает удаление вместо архивации', async () => {
    const wrapper = await mountTripWith(['Аня'])

    await wrapper.findAll('button').find((b) => b.text() === 'Завершить поездку')!.trigger('click')
    await flush()

    const emptyDialog = dialog(wrapper)
    expect(norm(emptyDialog.text())).toContain('архивировать нечего')
    await emptyDialog.findAll('button').find((b) => b.text() === 'Удалить поездку')!.trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Новая поездка')
    expect(norm(wrapper.text())).not.toContain('В архиве')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
  })

  it('с данными: счётчики потерь в подтверждении, архив не тронут', async () => {
    seedTrip((state) => {
      state.participants.push(
        { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
        { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
      )
      state.expenses.push({
        id: 'e1',
        title: 'Ужин',
        payerId: 'p1',
        amount: 10000,
        currencyCode: 'RUB',
        createdAt: ISO,
        split: { mode: 'equal', participantIds: ['p1', 'p2'] },
      })
      state.payments.push({
        id: 'pay1',
        fromId: 'p2',
        toId: 'p1',
        amount: 5000,
        currencyCode: 'RUB',
      })
    })
    seedArchive()
    const archiveRaw = localStorage.getItem(ARCHIVE_STORAGE_KEY)

    const wrapper = await mountApp()
    await wrapper.findAll('button').find((b) => b.text() === 'Удалить поездку')!.trigger('click')
    await flush()

    const deleteDialog = dialog(wrapper)
    const text = norm(deleteDialog.text())
    expect(text).toContain('2 участника')
    expect(text).toContain('1 расход')
    expect(text).toContain('1 выплату')
    expect(text).toContain('В архив поездка не попадёт')

    await deleteDialog.findAll('button').find((b) => b.text() === 'Удалить навсегда')!.trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Новая поездка')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    // Аварийный выход мимо архива: чужой архивный ключ не изменился.
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBe(archiveRaw)
  })
})

describe('создание при занятом архиве', () => {
  it('требует подтверждения замены; отмена не теряет форму', async () => {
    seedArchive()
    const wrapper = await mountApp()

    expect(norm(wrapper.text())).toContain('В архиве — поездка «Рим»')

    await wrapper.find('#trip-name').setValue('Кипр')
    await wrapper.findAll('button').find((b) => b.text().includes('RUB'))!.trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
    await flush()

    const replaceDialog = dialog(wrapper)
    expect(norm(replaceDialog.text())).toContain('Архив будет заменён')

    // Отмена: форма всё ещё заполнена, поездка не создана.
    await replaceDialog.findAll('button').find((b) => b.text() === 'Отмена')!.trigger('click')
    await flush()
    expect(dialog(wrapper).exists()).toBe(false)
    expect((wrapper.find('#trip-name').element as HTMLInputElement).value).toBe('Кипр')
    expect(wrapper.text()).toContain('Новая поездка')

    // Подтверждение: поездка создана, архив затёрт сам (стейт).
    await wrapper.findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
    await flush()
    await dialog(wrapper).findAll('button').find((b) => b.text() === 'Создать поездку')!.trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Базовая валюта: RUB')
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
  })
})

describe('повреждённый архив', () => {
  it('не мешает активной поездке и удаляется из экрана архива', async () => {
    seedTrip((state) => {
      state.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
    })
    localStorage.setItem(ARCHIVE_STORAGE_KEY, 'мусор')

    const wrapper = await mountApp()
    expect(wrapper.text()).toContain('Кипр')
    expect(wrapper.text()).toContain('Аня')

    await go('#/archive')
    expect(norm(wrapper.text())).toContain('Архивная поездка повреждена')

    await wrapper.findAll('button').find((b) => b.text() === 'Удалить архив')!.trigger('click')
    await flush()

    expect(wrapper.text()).toContain('Архив пуст')
    expect(localStorage.getItem(ARCHIVE_STORAGE_KEY)).toBeNull()
  })
})

describe('черновики переживают архив', () => {
  it('открытая форма расхода с текстом живёт на #/ и после захода в архив', async () => {
    const wrapper = await mountTripWith(['Аня'])
    await wrapper.findAll('button').find((b) => b.text().includes('Добавить расход'))!.trigger('click')
    await flush()
    await wrapper.find('input[placeholder="Название расхода"]').setValue('Ужин')

    await go('#/archive')
    await go('#/')

    const draft = wrapper.find('input[placeholder="Название расхода"]')
    expect(draft.exists()).toBe(true)
    expect((draft.element as HTMLInputElement).value).toBe('Ужин')
  })
})
