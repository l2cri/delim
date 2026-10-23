// Публичный интерфейс ядра «Делим». Пока — только операция «калькулятор»;
// остальные операции (schema, balances, settle, codec) войдут здесь же.
export type { EvalResult } from './calculator'
export { evalExpr } from './calculator'
