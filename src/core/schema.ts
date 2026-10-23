import { z } from 'zod'

/**
 * Операция «схема» интерфейса ядра: сборка стейта новой поездки и разбор чужого
 * стейта (localStorage, ссылка) с типизированной причиной отказа. Zod не течёт
 * наружу — все экспортируемые типы конкретные, ZodError мапится в TripParseError.
 */

export const SCHEMA_VERSION = 1

/** Лимиты поездки; нужны и валидатору, и подсказкам UI («осталось 3 участника»). */
export const TRIP_LIMITS = {
  participants: 20,
  expenses: 300,
  payments: 200,
  currencies: 10,
} as const

export type LimitName = keyof typeof TRIP_LIMITS

const safeIntMax = Number.MAX_SAFE_INTEGER

// Деньги — только безопасные целые: 1e21 проходит Number.isInteger, но ломает арифметику балансов.
const positiveAmount = z
  .number()
  .int()
  .positive()
  .refine((n) => n <= safeIntMax, 'сумма за пределами безопасных целых')

const nonnegativeAmount = z
  .number()
  .int()
  .nonnegative()
  .refine((n) => n <= safeIntMax, 'сумма за пределами безопасных целых')

const rationalSchema = z.strictObject({
  num: positiveAmount,
  den: positiveAmount,
})

const currencySchema = z.strictObject({
  code: z.string().min(1),
  rate: rationalSchema,
})

const participantSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  emoji: z.string().min(1),
})

const splitSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('equal'),
    participantIds: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    mode: z.literal('exact'),
    shares: z
      .array(
        z.strictObject({
          participantId: z.string().min(1),
          amount: nonnegativeAmount,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    mode: z.literal('shares'),
    shares: z
      .array(
        z.strictObject({
          participantId: z.string().min(1),
          weight: positiveAmount,
        }),
      )
      .min(1),
  }),
])

const expenseSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  payerId: z.string().min(1),
  amount: positiveAmount,
  currencyCode: z.string().min(1),
  createdAt: z.iso.datetime(),
  split: splitSchema,
})

const paymentSchema = z.strictObject({
  id: z.string().min(1),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  amount: positiveAmount,
  currencyCode: z.string().min(1),
})

const tripSchema = z.strictObject({
  version: z.literal(SCHEMA_VERSION),
  name: z.string().min(1),
  status: z.enum(['active', 'completed']),
  baseCurrency: z.string().min(1),
  currencies: z.array(currencySchema),
  participants: z.array(participantSchema),
  expenses: z.array(expenseSchema),
  payments: z.array(paymentSchema),
})

export type Rational = z.infer<typeof rationalSchema>
export type Currency = z.infer<typeof currencySchema>
export type Participant = z.infer<typeof participantSchema>
export type Split = z.infer<typeof splitSchema>
export type Expense = z.infer<typeof expenseSchema>
export type Payment = z.infer<typeof paymentSchema>
export type TripState = z.infer<typeof tripSchema>

export type TripParseError =
  | { kind: 'damaged'; detail: string }
  | { kind: 'version'; found: unknown }
  | { kind: 'limit'; limit: LimitName; max: number; actual: number }
  | { kind: 'references'; entity: string; field: string; missingId: string }

export type ParseResult =
  | { ok: true; state: TripState }
  | { ok: false; error: TripParseError }

/**
 * Собирает валидный стейт новой поездки: активная, из валют только базовая с курсом 1/1,
 * участники/расходы/выплаты пусты. Доверенный путь из своего UI: недопустимый ввод
 * (пустое название или код валюты) — исключение, а не ParseResult.
 */
export function createNewTrip(input: { name: string; baseCurrency: string }): TripState {
  const name = input.name.trim()
  if (!name) throw new Error('Название поездки не может быть пустым')
  const baseCurrency = input.baseCurrency.trim()
  if (!baseCurrency) throw new Error('Базовая валюта не может быть пустой')
  return {
    version: SCHEMA_VERSION,
    name,
    status: 'active',
    baseCurrency,
    currencies: [{ code: baseCurrency, rate: { num: 1, den: 1 } }],
    participants: [],
    expenses: [],
    payments: [],
  }
}

/**
 * Единственная точка разбора чужого стейта. All-or-nothing: либо целый валидный
 * стейт, либо типизированная причина отказа. Порядок проверки: форма (damaged) →
 * структура-дубликаты (damaged) → лимиты → референциальная целостность.
 */
export function parseTripState(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return failed(damaged('строка не является корректным JSON'))
  }
  if (!isJsonObject(data)) return failed(damaged('стейт должен быть JSON-объектом'))
  if ('version' in data && data.version !== SCHEMA_VERSION) {
    return failed({ kind: 'version', found: data.version })
  }
  const shape = tripSchema.safeParse(data)
  if (!shape.success) {
    const issue = shape.error.issues[0]
    const path = issue.path.join('.')
    return failed(damaged(path ? `${path}: ${issue.message}` : issue.message))
  }
  const state = shape.data
  const structural = checkStructure(state)
  if (structural) return failed(structural)
  const limit = checkLimits(state)
  if (limit) return failed(limit)
  const references = checkReferences(state)
  if (references) return failed(references)
  return { ok: true, state }
}

function damaged(detail: string): TripParseError {
  return { kind: 'damaged', detail }
}

function failed(error: TripParseError): ParseResult {
  return { ok: false, error }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitParticipantIds(split: Split): string[] {
  switch (split.mode) {
    case 'equal':
      return split.participantIds
    case 'exact':
      return split.shares.map((share) => share.participantId)
    case 'shares':
      return split.shares.map((share) => share.participantId)
  }
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length
}

function checkStructure(state: TripState): TripParseError | null {
  if (hasDuplicates(state.participants.map((p) => p.id))) {
    return damaged('дубликат id участника')
  }
  if (hasDuplicates(state.expenses.map((e) => e.id))) {
    return damaged('дубликат id расхода')
  }
  if (hasDuplicates(state.payments.map((p) => p.id))) {
    return damaged('дубликат id выплаты')
  }
  if (hasDuplicates(state.currencies.map((c) => c.code))) {
    return damaged('дубликат кода валюты')
  }
  for (const expense of state.expenses) {
    if (hasDuplicates(splitParticipantIds(expense.split))) {
      return damaged(`дубликат участника в сплите расхода ${expense.id}`)
    }
  }
  if (state.payments.some((payment) => payment.fromId === payment.toId)) {
    return damaged('выплата не может быть отправлена самому себе')
  }
  const baseEntries = state.currencies.filter((c) => c.code === state.baseCurrency)
  if (baseEntries.length !== 1) {
    return damaged('базовая валюта должна присутствовать в списке валют ровно один раз')
  }
  const baseRate = baseEntries[0].rate
  if (baseRate.num !== 1 || baseRate.den !== 1) {
    return damaged('курс базовой валюты должен быть ровно 1/1')
  }
  return null
}

function checkLimits(state: TripState): TripParseError | null {
  const counts: Record<LimitName, number> = {
    participants: state.participants.length,
    expenses: state.expenses.length,
    payments: state.payments.length,
    currencies: state.currencies.length,
  }
  for (const limit of ['participants', 'expenses', 'payments', 'currencies'] as const) {
    const max = TRIP_LIMITS[limit]
    if (counts[limit] > max) {
      return { kind: 'limit', limit, max, actual: counts[limit] }
    }
  }
  return null
}

function checkReferences(state: TripState): TripParseError | null {
  const participantIds = new Set(state.participants.map((p) => p.id))
  const currencyCodes = new Set(state.currencies.map((c) => c.code))
  for (const expense of state.expenses) {
    if (!participantIds.has(expense.payerId)) {
      return { kind: 'references', entity: 'expense', field: 'payerId', missingId: expense.payerId }
    }
    if (!currencyCodes.has(expense.currencyCode)) {
      return {
        kind: 'references',
        entity: 'expense',
        field: 'currencyCode',
        missingId: expense.currencyCode,
      }
    }
    for (const participantId of splitParticipantIds(expense.split)) {
      if (!participantIds.has(participantId)) {
        return {
          kind: 'references',
          entity: 'expense.split',
          field: 'participantId',
          missingId: participantId,
        }
      }
    }
  }
  for (const payment of state.payments) {
    if (!participantIds.has(payment.fromId)) {
      return { kind: 'references', entity: 'payment', field: 'fromId', missingId: payment.fromId }
    }
    if (!participantIds.has(payment.toId)) {
      return { kind: 'references', entity: 'payment', field: 'toId', missingId: payment.toId }
    }
    if (!currencyCodes.has(payment.currencyCode)) {
      return {
        kind: 'references',
        entity: 'payment',
        field: 'currencyCode',
        missingId: payment.currencyCode,
      }
    }
  }
  return null
}
