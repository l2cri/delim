import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewTrip, parseTripState } from '../../core'
import type { TripState } from '../../core'
import { PALETTE_COLORS, PALETTE_EMOJI } from './palette'
import { STORAGE_KEY } from './storage'
import { flushWatchers } from '../../../tests/helpers/flushWatchers'

const ISO = '2026-10-01T10:00:00.000Z'

/** Свежий синглтон на тест: сброс реестра модулей + динамический импорт = «перезагрузка». */
async function loadUseTrip() {
  return await import('./useTrip')
}

/** Поездка с двумя участниками (Аня, Боря) и базовой валютой RUB — сцена для расходов. */
async function loadTripForExpenses() {
  const { useTrip } = await loadUseTrip()
  const t = useTrip()
  t.createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
  const ids = ['Аня', 'Боря'].map((name) => {
    const added = t.addParticipant(name)
    if (!added.ok) throw new Error('участник не добавился')
    return added.participant.id
  })
  return { t, anya: ids[0], borya: ids[1] }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('загрузка при старте', () => {
  it('без сохранённой поездки — поездки нет, ошибок нет', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, loadError } = useTrip()

    expect(trip.value).toBeNull()
    expect(loadError.value).toBeNull()
  })

  it('сохранённая поездка восстанавливается вместе с участниками', async () => {
    const state = createNewTrip({ name: 'Кипр-2027', baseCurrency: 'EUR' })
    state.participants.push({ id: 'p1', name: 'Аня', color: '#059669', emoji: '🐻' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))

    const { useTrip } = await loadUseTrip()
    const { trip, loadError } = useTrip()

    expect(loadError.value).toBeNull()
    expect(trip.value?.name).toBe('Кипр-2027')
    expect(trip.value?.baseCurrency).toBe('EUR')
    expect(trip.value?.participants.map((p) => p.name)).toEqual(['Аня'])
  })

  it('повреждённые данные — типизированная ошибка вместо падения приложения', async () => {
    localStorage.setItem(STORAGE_KEY, '{это не json')

    const { useTrip } = await loadUseTrip()
    const { trip, loadError } = useTrip()

    expect(trip.value).toBeNull()
    expect(loadError.value?.kind).toBe('damaged')
  })

  it('стейт другой версии — причина version', async () => {
    const state = createNewTrip({ name: 'Кипр', baseCurrency: 'EUR' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 99 }))

    const { useTrip } = await loadUseTrip()
    const { trip, loadError } = useTrip()

    expect(trip.value).toBeNull()
    expect(loadError.value).toEqual({ kind: 'version', found: 99 })
  })

  it('discardCorrupted очищает хранилище и ошибку', async () => {
    localStorage.setItem(STORAGE_KEY, 'мусор')
    const { useTrip } = await loadUseTrip()
    const { discardCorrupted, loadError } = useTrip()

    expect(loadError.value?.kind).toBe('damaged')
    discardCorrupted()

    expect(loadError.value).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('создание поездки', () => {
  it('создаёт активную поездку, имя и валюта обрезаны, базовая валюта 1/1', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip } = useTrip()

    expect(createTrip({ name: '  Кипр-2027  ', baseCurrency: ' RUB ' })).toEqual({ ok: true })

    expect(trip.value?.name).toBe('Кипр-2027')
    expect(trip.value?.baseCurrency).toBe('RUB')
    expect(trip.value?.status).toBe('active')
    expect(trip.value?.currencies).toEqual([{ code: 'RUB', rate: { num: 1, den: 1 } }])
  })

  it('пустое название — отказ, поездка не создаётся', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip } = useTrip()

    expect(createTrip({ name: '   ', baseCurrency: 'RUB' })).toEqual({
      ok: false,
      reason: 'empty-name',
    })
    expect(trip.value).toBeNull()
  })

  it('пустая валюта — отказ, поездка не создаётся', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip } = useTrip()

    expect(createTrip({ name: 'Кипр', baseCurrency: '' })).toEqual({
      ok: false,
      reason: 'empty-currency',
    })
    expect(trip.value).toBeNull()
  })
})

describe('автосохранение', () => {
  it('мутация попадает в хранилище через 500 мс и парсится обратно ядром', async () => {
    const { useTrip } = await loadUseTrip()
    const { createTrip, addParticipant } = useTrip()

    createTrip({ name: 'Кипр-2027', baseCurrency: 'RUB' })
    addParticipant('Аня')
    await flushWatchers()

    vi.advanceTimersByTime(499)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    vi.advanceTimersByTime(1)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = parseTripState(raw as string)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.state.name).toBe('Кипр-2027')
    expect(parsed.state.participants.map((p) => p.name)).toEqual(['Аня'])
  })

  it('серия мутаций в пределах окна — одна запись в хранилище', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem')
    const { useTrip } = await loadUseTrip()
    const { createTrip, addParticipant, renameParticipant } = useTrip()

    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    await flushWatchers()
    const first = addParticipant('Аня')
    await flushWatchers()
    addParticipant('Боря')
    await flushWatchers()
    if (first.ok) renameParticipant(first.participant.id, 'Анюта')
    await flushWatchers()

    vi.advanceTimersByTime(500)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('перезагрузка приложения восстанавливает поездку и участников', async () => {
    const first = await loadUseTrip()
    const t1 = first.useTrip()
    t1.createTrip({ name: 'Грузия', baseCurrency: 'GEL' })
    t1.addParticipant('Аня')
    t1.addParticipant('Боря')
    await flushWatchers()
    vi.advanceTimersByTime(500)

    vi.resetModules()
    const second = await loadUseTrip()
    const t2 = second.useTrip()

    expect(t2.trip.value?.name).toBe('Грузия')
    expect(t2.trip.value?.baseCurrency).toBe('GEL')
    expect(t2.trip.value?.participants.map((p) => p.name)).toEqual(['Аня', 'Боря'])
  })
})

describe('участники: добавление', () => {
  it('добавляет участника с обрезанным именем, автоцветом и эмодзи из палитр', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    const result = addParticipant('  Аня  ')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.participant.name).toBe('Аня')
    expect(PALETTE_COLORS).toContain(result.participant.color)
    expect(PALETTE_EMOJI).toContain(result.participant.emoji)
    expect(trip.value?.participants).toHaveLength(1)
  })

  it('пустое имя — отказ', async () => {
    const { useTrip } = await loadUseTrip()
    const { createTrip, addParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    expect(addParticipant('   ')).toEqual({ ok: false, reason: 'empty-name' })
  })

  it('первые 16 участников получают попарно различные цвета и эмодзи', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    for (let i = 1; i <= 16; i++) {
      expect(addParticipant(`Участник ${i}`).ok).toBe(true)
    }

    const colors = trip.value?.participants.map((p) => p.color) ?? []
    const emoji = trip.value?.participants.map((p) => p.emoji) ?? []
    expect(new Set(colors).size).toBe(16)
    expect(new Set(emoji).size).toBe(16)
  })

  it('двадцатый участник добавляется, двадцать первый — отказ с лимитом', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    for (let i = 1; i <= 20; i++) {
      expect(addParticipant(`Участник ${i}`).ok).toBe(true)
    }
    expect(addParticipant('Двадцать первый')).toEqual({
      ok: false,
      reason: 'limit',
      max: 20,
    })
    expect(trip.value?.participants).toHaveLength(20)
  })
})

describe('участники: переименование', () => {
  it('переименовывает участника, имя обрезается', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant, renameParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    const added = addParticipant('Аня')
    if (!added.ok) return

    expect(renameParticipant(added.participant.id, '  Анюта  ')).toEqual({ ok: true })
    expect(trip.value?.participants[0]?.name).toBe('Анюта')
  })

  it('пустое имя — отказ', async () => {
    const { useTrip } = await loadUseTrip()
    const { createTrip, addParticipant, renameParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    const added = addParticipant('Аня')
    if (!added.ok) return

    expect(renameParticipant(added.participant.id, ' ')).toEqual({
      ok: false,
      reason: 'empty-name',
    })
  })

  it('несуществующий id — отказ not-found', async () => {
    const { useTrip } = await loadUseTrip()
    const { createTrip, renameParticipant } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    expect(renameParticipant('ghost', 'Аня')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('участники: удаление', () => {
  /** Поездка с четырьмя участниками; расход платит p1 за p2, выплата от p2 к p3. */
  async function loadTripWithUsages() {
    const { useTrip } = await loadUseTrip()
    const t = useTrip()
    t.createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    const [p1, p2, p3, p4] = ['Аня', 'Боря', 'Вика', 'Гоша'].map((name) => {
      const result = t.addParticipant(name)
      if (!result.ok) throw new Error('участник не добавился')
      return result.participant
    })
    const trip = t.trip.value as TripState
    trip.expenses.push({
      id: 'e1',
      title: 'Такси',
      payerId: p1.id,
      amount: 1000,
      currencyCode: 'RUB',
      createdAt: ISO,
      split: { mode: 'equal', participantIds: [p2.id] },
    })
    trip.payments.push({
      id: 'v1',
      fromId: p2.id,
      toId: p3.id,
      amount: 500,
      currencyCode: 'RUB',
    })
    return { t, p1, p2, p3, p4 }
  }

  it('свободный участник удаляется', async () => {
    const { t, p4 } = await loadTripWithUsages()

    expect(t.removeParticipant(p4.id)).toEqual({ ok: true })
    expect(t.trip.value?.participants.map((p) => p.name)).toEqual(['Аня', 'Боря', 'Вика'])
  })

  it('плательщик расхода не удаляется — отказ с числом расходов и выплат', async () => {
    const { t, p1 } = await loadTripWithUsages()

    expect(t.removeParticipant(p1.id)).toEqual({
      ok: false,
      reason: 'in-use',
      expenses: 1,
      payments: 0,
    })
  })

  it('участник в сплите и в выплате — отказ считает и то и другое', async () => {
    const { t, p2 } = await loadTripWithUsages()

    expect(t.removeParticipant(p2.id)).toEqual({
      ok: false,
      reason: 'in-use',
      expenses: 1,
      payments: 1,
    })
  })

  it('получатель выплаты не удаляется', async () => {
    const { t, p3 } = await loadTripWithUsages()

    expect(t.removeParticipant(p3.id)).toEqual({
      ok: false,
      reason: 'in-use',
      expenses: 0,
      payments: 1,
    })
  })
})

describe('участники: перегенерация аватара', () => {
  it('меняет и цвет, и эмодзи на значения из палитр, отличные от прежних', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant, regenerateAvatar } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    const added = addParticipant('Аня')
    if (!added.ok) return
    const oldColor = added.participant.color
    const oldEmoji = added.participant.emoji

    regenerateAvatar(added.participant.id)

    const updated = trip.value?.participants[0]
    expect(updated?.color).not.toBe(oldColor)
    expect(updated?.emoji).not.toBe(oldEmoji)
    expect(PALETTE_COLORS).toContain(updated?.color)
    expect(PALETTE_EMOJI).toContain(updated?.emoji)
  })

  it('несуществующий id — no-op без исключений', async () => {
    const { useTrip } = await loadUseTrip()
    const { createTrip, regenerateAvatar } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })

    expect(() => regenerateAvatar('ghost')).not.toThrow()
  })

  it('перегенерация сохраняет уникальность: новый аватар не занимает чужие значения', async () => {
    const { useTrip } = await loadUseTrip()
    const { trip, createTrip, addParticipant, regenerateAvatar } = useTrip()
    createTrip({ name: 'Кипр', baseCurrency: 'RUB' })
    for (const name of ['Аня', 'Боря', 'Вика']) addParticipant(name)
    const first = trip.value?.participants[0]
    if (!first) throw new Error('участники не добавились')

    regenerateAvatar(first.id)

    const colors = trip.value?.participants.map((p) => p.color) ?? []
    const emoji = trip.value?.participants.map((p) => p.emoji) ?? []
    expect(new Set(colors).size).toBe(3)
    expect(new Set(emoji).size).toBe(3)
  })
})

describe('расходы: добавление', () => {
  it('equal — расход в списке, название обрезано, id и createdAt заполнены', async () => {
    const { t, anya, borya } = await loadTripForExpenses()

    const result = t.addExpense({
      title: '  Такси  ',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]).toEqual(result.expense)
    expect(result.expense.title).toBe('Такси')
    expect(result.expense.id).not.toBe('')
    expect(Number.isNaN(Date.parse(result.expense.createdAt))).toBe(false)
  })

  it('exact сходящийся — расход в списке, название обрезано, id и createdAt заполнены', async () => {
    const { t, anya, borya } = await loadTripForExpenses()

    const result = t.addExpense({
      title: '  Продукты  ',
      payerId: anya,
      amount: 1500,
      currencyCode: 'RUB',
      split: {
        mode: 'exact',
        shares: [
          { participantId: anya, amount: 700 },
          { participantId: borya, amount: 800 },
        ],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]).toEqual(result.expense)
    expect(result.expense.title).toBe('Продукты')
    expect(result.expense.id).not.toBe('')
    expect(Number.isNaN(Date.parse(result.expense.createdAt))).toBe(false)
  })

  it('shares — расход в списке, название обрезано, id и createdAt заполнены', async () => {
    const { t, anya, borya } = await loadTripForExpenses()

    const result = t.addExpense({
      title: '  Бензин  ',
      payerId: borya,
      amount: 1000,
      currencyCode: 'RUB',
      split: {
        mode: 'shares',
        shares: [
          { participantId: anya, weight: 1 },
          { participantId: borya, weight: 3 },
        ],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]).toEqual(result.expense)
    expect(result.expense.title).toBe('Бензин')
    expect(result.expense.id).not.toBe('')
    expect(Number.isNaN(Date.parse(result.expense.createdAt))).toBe(false)
  })

  it('пустое название — отказ, расход не добавляется', async () => {
    const { t, anya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: '   ',
        payerId: anya,
        amount: 1000,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya] },
      }),
    ).toEqual({ ok: false, reason: 'empty-title' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('сумма ноль, отрицательная или дробная — отказ bad-amount', async () => {
    const { t, anya } = await loadTripForExpenses()

    for (const amount of [0, -5, 1.5]) {
      expect(
        t.addExpense({
          title: 'Такси',
          payerId: anya,
          amount,
          currencyCode: 'RUB',
          split: { mode: 'equal', participantIds: [anya] },
        }),
      ).toEqual({ ok: false, reason: 'bad-amount' })
    }
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('сплит без участников — отказ empty-split в режимах equal и exact', async () => {
    const { t, anya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Такси',
        payerId: anya,
        amount: 1000,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [] },
      }),
    ).toEqual({ ok: false, reason: 'empty-split' })
    expect(
      t.addExpense({
        title: 'Такси',
        payerId: anya,
        amount: 1000,
        currencyCode: 'RUB',
        split: { mode: 'exact', shares: [] },
      }),
    ).toEqual({ ok: false, reason: 'empty-split' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('триста первый расход — отказ с лимитом 300', async () => {
    const { t, anya } = await loadTripForExpenses()

    for (let i = 1; i <= 300; i++) {
      const added = t.addExpense({
        title: `Расход ${i}`,
        payerId: anya,
        amount: 10,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya] },
      })
      if (!added.ok) throw new Error(`расход ${i} не добавился`)
    }

    expect(
      t.addExpense({
        title: 'Лишний',
        payerId: anya,
        amount: 10,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya] },
      }),
    ).toEqual({ ok: false, reason: 'limit', max: 300 })
    expect(t.trip.value?.expenses).toHaveLength(300)
  })

  it('неизвестный плательщик — отказ с id призрака', async () => {
    const { t, anya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Такси',
        payerId: 'ghost-payer',
        amount: 1000,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya] },
      }),
    ).toEqual({ ok: false, reason: 'unknown-participant', id: 'ghost-payer' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('неизвестный участник сплита — отказ с его id', async () => {
    const { t, anya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Такси',
        payerId: anya,
        amount: 1000,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya, 'ghost-in-split'] },
      }),
    ).toEqual({ ok: false, reason: 'unknown-participant', id: 'ghost-in-split' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('валюта не из списка поездки — отказ с кодом', async () => {
    const { t, anya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Такси',
        payerId: anya,
        amount: 1000,
        currencyCode: 'USD',
        split: { mode: 'equal', participantIds: [anya] },
      }),
    ).toEqual({ ok: false, reason: 'unknown-currency', code: 'USD' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('exact не покрывает сумму — отказ split-mismatch с положительной дельтой', async () => {
    const { t, anya, borya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Продукты',
        payerId: anya,
        amount: 1500,
        currencyCode: 'RUB',
        split: {
          mode: 'exact',
          shares: [
            { participantId: anya, amount: 700 },
            { participantId: borya, amount: 700 },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: 'split-mismatch', delta: 100 })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })

  it('exact превышает сумму — отказ split-mismatch с отрицательной дельтой', async () => {
    const { t, anya, borya } = await loadTripForExpenses()

    expect(
      t.addExpense({
        title: 'Продукты',
        payerId: anya,
        amount: 1500,
        currencyCode: 'RUB',
        split: {
          mode: 'exact',
          shares: [
            { participantId: anya, amount: 800 },
            { participantId: borya, amount: 800 },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: 'split-mismatch', delta: -100 })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })
})

describe('расходы: обновление', () => {
  /** Сцена с одним расходом (equal на двоих), оплаченным Аней. */
  async function loadTripWithOneExpense() {
    const { t, anya, borya } = await loadTripForExpenses()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya, borya] },
    })
    if (!added.ok) throw new Error('расход не добавился')
    return { t, anya, borya, original: added.expense }
  }

  it('несуществующий id — отказ not-found', async () => {
    const { t, anya } = await loadTripWithOneExpense()

    expect(
      t.updateExpense('ghost', {
        title: 'Продукты',
        payerId: anya,
        amount: 1500,
        currencyCode: 'RUB',
        split: { mode: 'equal', participantIds: [anya] },
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })

  it('сохраняет id и createdAt, заменяет остальные поля', async () => {
    const { t, anya, borya, original } = await loadTripWithOneExpense()

    const result = t.updateExpense(original.id, {
      title: '  Продукты  ',
      payerId: borya,
      amount: 1500,
      currencyCode: 'RUB',
      split: {
        mode: 'exact',
        shares: [
          { participantId: anya, amount: 700 },
          { participantId: borya, amount: 800 },
        ],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.expense.id).toBe(original.id)
    expect(result.expense.createdAt).toBe(original.createdAt)
    expect(result.expense.title).toBe('Продукты')
    expect(result.expense.payerId).toBe(borya)
    expect(result.expense.amount).toBe(1500)
    expect(result.expense.split.mode).toBe('exact')
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]).toEqual(result.expense)
  })

  it('split-mismatch действует и при обновлении — расход не меняется', async () => {
    const { t, anya, borya, original } = await loadTripWithOneExpense()

    expect(
      t.updateExpense(original.id, {
        title: 'Продукты',
        payerId: anya,
        amount: 1500,
        currencyCode: 'RUB',
        split: {
          mode: 'exact',
          shares: [
            { participantId: anya, amount: 700 },
            { participantId: borya, amount: 700 },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: 'split-mismatch', delta: 100 })
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]?.title).toBe('Такси')
    expect(t.trip.value?.expenses[0]?.amount).toBe(1000)
  })
})

describe('расходы: удаление', () => {
  it('удаляет расход по id', async () => {
    const { t, anya } = await loadTripForExpenses()
    const first = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya] },
    })
    const second = t.addExpense({
      title: 'Продукты',
      payerId: anya,
      amount: 500,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya] },
    })
    if (!first.ok || !second.ok) throw new Error('расходы не добавились')

    expect(t.removeExpense(first.expense.id)).toEqual({ ok: true })
    expect(t.trip.value?.expenses).toHaveLength(1)
    expect(t.trip.value?.expenses[0]?.id).toBe(second.expense.id)
  })

  it('повторное удаление того же id — отказ not-found', async () => {
    const { t, anya } = await loadTripForExpenses()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya] },
    })
    if (!added.ok) throw new Error('расход не добавился')

    expect(t.removeExpense(added.expense.id)).toEqual({ ok: true })
    expect(t.removeExpense(added.expense.id)).toEqual({ ok: false, reason: 'not-found' })
    expect(t.trip.value?.expenses).toHaveLength(0)
  })
})

describe('расходы: связь с участниками', () => {
  it('после addExpense плательщик не удаляется — in-use с числом расходов', async () => {
    const { t, anya } = await loadTripForExpenses()
    const added = t.addExpense({
      title: 'Такси',
      payerId: anya,
      amount: 1000,
      currencyCode: 'RUB',
      split: { mode: 'equal', participantIds: [anya] },
    })
    if (!added.ok) throw new Error('расход не добавился')

    expect(t.removeParticipant(anya)).toEqual({
      ok: false,
      reason: 'in-use',
      expenses: 1,
      payments: 0,
    })
  })
})
