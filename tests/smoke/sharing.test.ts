import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compressToEncodedURIComponent } from 'lz-string'
import {
  createNewTrip,
  decodeTripState,
  encodeTripState,
  SCHEMA_VERSION,
  SHARE_PAYLOAD_LIMIT,
  SHARE_PAYLOAD_WARN,
} from '../../src/core'
import type { TripState } from '../../src/core'
import { STORAGE_KEY } from '../../src/app/state/storage'
import { flushWatchers as flush } from '../helpers/flushWatchers'
import {
  ISO,
  balanceTexts,
  mountApp,
  norm,
  seedTrip,
  seedWithZeroBalance,
  transferTexts,
} from '../helpers/smoke'

/**
 * Дымовые тесты шеринга ссылкой (тикет 15): сквозной путь «Поделиться → ссылка →
 * зритель/ошибки». Гоняют только видимое пользователю через корневой App: тап
 * «Поделиться» кладёт в стаб буфера полную ссылку `…#/t=…`, ссылка открывается
 * поездкой только для чтения и не трогает localStorage организатора, битые
 * варианты дают экран «Ссылка повреждена» с причиной. Синглтоны стейта (роутер,
 * useTrip, useViewer) читают location.hash при импорте — хэш ставится до
 * mountApp и сбрасывается реестром модулей в beforeEach (паттерн receipt.test.ts).
 */

/** Подмена буфера: копирование уходит в стаб, а не в системный буфер (приём
 *  receipt.test.ts — проверяем вызов и содержимое, не сам буфер). */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

/** Префикс полной ссылки, который собирает экран поездки. */
function shareLinkPrefix(): string {
  return `${window.location.origin}${window.location.pathname}#/t=`
}

/** Вторая поездка для ссылки: «Сочи», Аня и Боря, расход 1000,00 RUB поровну
 *  на двоих → Аня +500,00, Боря −500,00, один перевод «Боря → Аня 500,00». */
function sochiTrip(): TripState {
  const state = createNewTrip({ name: 'Сочи', baseCurrency: 'RUB' })
  state.participants.push(
    { id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' },
    { id: 'p2', name: 'Боря', color: '#0284c7', emoji: '🐧' },
  )
  state.expenses.push({
    id: 'e1',
    title: 'Обед',
    payerId: 'p1',
    amount: 100000, // 1000,00 RUB
    currencyCode: 'RUB',
    createdAt: ISO,
    split: { mode: 'equal', participantIds: ['p1', 'p2'] },
  })
  return state
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  window.location.hash = ''
})

afterEach(() => {
  // Сессия = вкладка: закрытие гасит дебаунс-сейв синглтона useTrip до очистки
  // хранилища (тот же паттерн, что в receipt.test.ts — иначе взведённый таймер
  // срабатывает посреди следующего теста).
  window.dispatchEvent(new Event('beforeunload'))
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('«Поделиться» у организатора', () => {
  it('тап кладёт в буфер ссылку, полезная нагрузка которой декодируется в тот же стейт', async () => {
    const writeText = stubClipboard()
    seedWithZeroBalance()
    const seedRaw = localStorage.getItem(STORAGE_KEY)
    expect(seedRaw).not.toBeNull()
    const seedState = JSON.parse(seedRaw as string)
    const wrapper = await mountApp()

    const share = wrapper.findAll('button').find((b) => norm(b.text()).includes('Поделиться'))
    expect(share).toBeTruthy()
    await share!.trigger('click')
    await flush()

    // Копирование состоялось ровно один раз — и это полная ссылка приложения.
    expect(writeText).toHaveBeenCalledTimes(1)
    const link = writeText.mock.calls[0][0] as string
    expect(link.startsWith(shareLinkPrefix())).toBe(true)

    // Полезная нагрузка (после '#/t=') декодируется ядром в сид-стейт целиком.
    const decoded = decodeTripState(link.slice(shareLinkPrefix().length))
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.state).toEqual(seedState)

    expect(norm(wrapper.text())).toContain('Ссылка скопирована — отправьте её участникам')
  })

  it('несжимаемо длинная поездка: ссылка всё равно копируется, но с предупреждением о длине', async () => {
    const writeText = stubClipboard()
    // 60 000 случайных hex-символов в названии расхода: случайные данные lz-string не сжимает.
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(30_000)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    expect(hex.length).toBe(60_000)
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
    // Предусловие сценария: полезная нагрузка действительно длиннее порога предупреждения,
    // иначе тест сам себе противоречит.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as TripState
    expect(encodeTripState(stored).length).toBeGreaterThan(SHARE_PAYLOAD_WARN)

    const wrapper = await mountApp()
    const share = wrapper.findAll('button').find((b) => norm(b.text()).includes('Поделиться'))
    expect(share).toBeTruthy()
    await share!.trigger('click')
    await flush()

    // Предупреждение не блокирует: буфер получил полную ссылку.
    expect(writeText).toHaveBeenCalledTimes(1)
    const link = writeText.mock.calls[0][0] as string
    expect(link.startsWith(shareLinkPrefix())).toBe(true)

    // …и экран называет и длину, и слово «длинная».
    const text = norm(wrapper.text())
    expect(text).toContain('длинная')
    expect(text).toContain(String(link.length))
  })
})

describe('ссылка открывается у зрителя', () => {
  it('поездка только для чтения: бейдж режима, балансы и переводы, без редактирования', async () => {
    seedWithZeroBalance() // локальная поездка организатора «Кипр»
    window.location.hash = '#/t=' + encodeTripState(sochiTrip())
    const wrapper = await mountApp()

    // Название поездки из ссылки и бейдж режима — виден без пояснений.
    expect(norm(wrapper.text())).toContain('Сочи')
    const badge = wrapper.find('[aria-label="Режим зрителя"]')
    expect(badge.exists()).toBe(true)
    expect(norm(badge.text())).toBe('Только чтение')

    // Данные поездки видны: расход с группировкой разрядов, балансы, перевод.
    const expenseRows = wrapper
      .find('[aria-label="Список расходов"]')
      .findAll('li')
      .map((li) => norm(li.text()))
    expect(expenseRows.some((row) => row.includes('Обед') && row.includes('1 000,00 RUB'))).toBe(
      true,
    )
    const balances = balanceTexts(wrapper)
    expect(balances.some((row) => row.includes('Аня') && row.includes('должны ему 500,00'))).toBe(
      true,
    )
    expect(balances.some((row) => row.includes('Боря') && row.includes('должен 500,00'))).toBe(true)
    const transfers = transferTexts(wrapper)
    expect(transfers).toHaveLength(1)
    expect(transfers[0]).toContain('Боря')
    expect(transfers[0]).toContain('Аня')
    expect(transfers[0]).toContain('500,00 RUB')

    // Элементов редактирования нет: ни форм, ни кнопок добавления, ни ✏️/🗑️.
    expect(wrapper.find('input[placeholder="Имя участника"]').exists()).toBe(false)
    const buttonTexts = wrapper.findAll('button').map((b) => norm(b.text()))
    expect(buttonTexts.some((t) => t.includes('Добавить расход'))).toBe(false)
    expect(buttonTexts.some((t) => t.includes('Добавить выплату'))).toBe(false)
    expect(buttonTexts.some((t) => t.includes('Поделиться'))).toBe(false)
    expect(wrapper.find('button[aria-label^="Изменить расход"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Удалить расход"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Удалить участника"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Переименовать участника"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Перегенерировать аватар"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Изменить выплату"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label^="Удалить выплату"]').exists()).toBe(false)

    // Квитанция доступна зрителю: копирование текста — это чтение.
    const receiptButton = wrapper
      .findAll('button')
      .find((b) => norm(b.text()) === 'Скопировать квитанцию')
    expect(receiptButton).toBeTruthy()
  })

  it('открытие ссылки не трогает локальную поездку организатора; выход возвращает к ней', async () => {
    seedWithZeroBalance()
    const organizerRaw = localStorage.getItem(STORAGE_KEY)
    expect(organizerRaw).not.toBeNull()

    window.location.hash = '#/t=' + encodeTripState(sochiTrip())
    const wrapper = await mountApp()
    expect(norm(wrapper.text())).toContain('Сочи') // посмотрели как зритель
    await flush()

    // Хранилище организатора байт-в-байт то же — зрительский режим молчит.
    expect(localStorage.getItem(STORAGE_KEY)).toBe(organizerRaw)

    // Выход к своим данным: поездка организатора на месте.
    window.location.hash = '#/'
    window.dispatchEvent(new Event('hashchange'))
    await flush()
    const homeText = norm(wrapper.text())
    expect(homeText).toContain('Кипр')
    expect(homeText).toContain('Ужин')
  })
})

describe('битые ссылки', () => {
  it('мусорная полезная нагрузка — «Ссылка повреждена», localStorage организатора не тронут', async () => {
    seedWithZeroBalance()
    const organizerRaw = localStorage.getItem(STORAGE_KEY)

    window.location.hash = '#/t=broken123'
    const wrapper = await mountApp()

    const text = norm(wrapper.text())
    expect(text).toContain('Ссылка повреждена')
    // Причина — про потерянные символы/нечитаемость, а не пустой экран.
    expect(text).toContain('не удалось прочитать')
    expect(text).toContain('потерялась')
    expect(localStorage.getItem(STORAGE_KEY)).toBe(organizerRaw)
  })

  it('обрезанная ссылка — «Ссылка повреждена»', async () => {
    const payload = encodeTripState(sochiTrip())
    window.location.hash = '#/t=' + payload.slice(0, Math.floor(payload.length / 2))
    const wrapper = await mountApp()

    expect(norm(wrapper.text())).toContain('Ссылка повреждена')
  })

  it('ссылка чужой версии схемы — «Ссылка повреждена» с текстом про другую версию', async () => {
    // Ручная сборка полезной нагрузки в формате кортежей кодека (src/core/codec.ts):
    // trip := [версия, название, статусIdx, базовая валюта, валюты, участники, расходы, выплаты].
    const foreignPayload = compressToEncodedURIComponent(
      JSON.stringify([SCHEMA_VERSION + 1, 'Сочи', 0, 'RUB', [['RUB', 1, 1]], [], [], []]),
    )
    window.location.hash = '#/t=' + foreignPayload
    const wrapper = await mountApp()

    const text = norm(wrapper.text())
    expect(text).toContain('Ссылка повреждена')
    expect(text).toContain('другой версией')
  })

  it('полезная нагрузка длиннее лимита — «Ссылка повреждена» про символы и лимит', async () => {
    window.location.hash = '#/t=' + 'a'.repeat(SHARE_PAYLOAD_LIMIT + 1)
    const wrapper = await mountApp()

    const text = norm(wrapper.text())
    expect(text).toContain('Ссылка повреждена')
    expect(text).toContain('символов')
    expect(text).toContain('лимит')
    expect(text).toContain(String(SHARE_PAYLOAD_LIMIT + 1))
  })
})
