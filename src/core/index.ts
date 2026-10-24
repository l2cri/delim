// Публичный интерфейс ядра «Делим». Операции: схема, калькулятор, балансы,
// сведение, кодек — все пять в этом файле. Рамка «пять операций» неизменна:
// splitAmounts и convertToBase — производные денежные отображения тех же правил
// (доли расхода до сохранения и конвертация суммы для показа), а не шестая
// операция: то же вычисление, что в балансах, только для экрана. Туда же
// parseRate — производный денежный разбор той же рамки, входная сторона к
// convertToBase (настройки вводят курс дробью — ядро даёт точное рациональное),
// по прецеденту splitAmounts/convertToBase из тикета 09.
export type {
  LimitName,
  Participant,
  Payment,
  Expense,
  Rational,
  Currency,
  Split,
  TripState,
  TripParseError,
  ParseResult,
} from './schema'
export { SCHEMA_VERSION, TRIP_LIMITS, createNewTrip, parseTripState } from './schema'
export type { EvalResult } from './calculator'
export { evalExpr } from './calculator'
export type { BalanceEntry } from './balances'
export { computeBalances } from './balances'
export type { Transfer } from './settle'
export { settle } from './settle'
export type { SplitAmount } from './splits'
export { splitAmounts, convertToBase } from './splits'
export type { ParseRateResult } from './rates'
export { parseRate } from './rates'
export type { DecodeResult, TripDecodeError } from './codec'
export { encodeTripState, decodeTripState, SHARE_PAYLOAD_LIMIT, SHARE_PAYLOAD_WARN } from './codec'
