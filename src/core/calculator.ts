// Калькулятор-парсер выражений: строка с `+ - * / ( )` и унарным минусом →
// значение в минорных единицах либо «некорректно» (ok:false, без исключений).
//
// Числа вводятся в основных единицах (разделитель — точка или запятая),
// арифметика внутри — точная рациональная на bigint (никакого float),
// округление до минорной единицы (×100) происходит один раз на выходе,
// half away from zero: 0.005 → 1, -0.005 → −1.

/** Результат вычисления выражения: целое число минорных единиц либо некорректно. */
export type EvalResult = { ok: true; minor: number } | { ok: false }

/** Точное рациональное число n/d: d > 0, сокращено до несократимой дроби. */
interface Rat {
  n: bigint
  d: bigint
}

/** Приватная ошибка разбора/деления на ноль; наружу не выходит — evalExpr превращает её в ok:false. */
class InvalidExpression extends Error {}

function fail(): never {
  throw new InvalidExpression()
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a
  let y = b < 0n ? -b : b
  while (y > 0n) {
    const r = x % y
    x = y
    y = r
  }
  return x
}

/** Конструирует несократимую дробь со строгоположительным знаменателем. */
function rat(n: bigint, d: bigint): Rat {
  if (d === 0n) fail() // недостижимо из операций ниже, но защищает инвариант
  if (d < 0n) {
    n = -n
    d = -d
  }
  const g = gcd(n, d)
  return { n: n / g, d: d / g }
}

function add(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d)
}

function sub(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d)
}

function mul(a: Rat, b: Rat): Rat {
  return rat(a.n * b.n, a.d * b.d)
}

function div(a: Rat, b: Rat): Rat {
  if (b.n === 0n) fail() // деление на ноль — некорректно
  return rat(a.n * b.d, a.d * b.n)
}

function neg(a: Rat): Rat {
  return { n: -a.n, d: a.d }
}

type Token =
  | { kind: 'num'; value: Rat }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }

/**
 * Токенизация: литерал \d+([.,]\d+)? (без ведущего/хвостового разделителя),
 * бинарные операторы и скобки; пробельные символы между токенами игнорируются.
 * Всё остальное — некорректно.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (isDigit(ch)) {
      const intStart = i
      while (i < input.length && isDigit(input[i])) i++
      const intDigits = input.slice(intStart, i)
      let fracDigits = ''
      // Разделитель дробной части валиден, только если за ним идёт цифра
      // («1.» и «1..2» — мусор; «1,5.5» и «1,000,5» — второй разделитель ломает разбор).
      if (
        i + 1 < input.length &&
        (input[i] === '.' || input[i] === ',') &&
        isDigit(input[i + 1])
      ) {
        i++
        const fracStart = i
        while (i < input.length && isDigit(input[i])) i++
        fracDigits = input.slice(fracStart, i)
      }
      tokens.push({
        kind: 'num',
        value: rat(BigInt(intDigits + fracDigits), 10n ** BigInt(fracDigits.length)),
      })
      continue
    }
    switch (ch) {
      case '+':
        tokens.push({ kind: 'op', op: '+' })
        break
      case '-':
        tokens.push({ kind: 'op', op: '-' })
        break
      case '*':
        tokens.push({ kind: 'op', op: '*' })
        break
      case '/':
        tokens.push({ kind: 'op', op: '/' })
        break
      case '(':
        tokens.push({ kind: 'lparen' })
        break
      case ')':
        tokens.push({ kind: 'rparen' })
        break
      default:
        fail()
    }
    i++
  }
  return tokens
}

/**
 * Рекурсивный спуск:
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-' unary | primary
 *   primary:= число | '(' expr ')'
 * Левоассоциативность — циклом; унарный плюс («+1») не поддержан.
 */
function parse(tokens: Token[]): Rat {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]

  function expr(): Rat {
    let left = term()
    for (;;) {
      const t = peek()
      if (t?.kind === 'op' && (t.op === '+' || t.op === '-')) {
        pos++
        const right = term()
        left = t.op === '+' ? add(left, right) : sub(left, right)
      } else {
        return left
      }
    }
  }

  function term(): Rat {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.kind === 'op' && (t.op === '*' || t.op === '/')) {
        pos++
        const right = unary()
        left = t.op === '*' ? mul(left, right) : div(left, right)
      } else {
        return left
      }
    }
  }

  function unary(): Rat {
    const t = peek()
    if (t?.kind === 'op' && t.op === '-') {
      pos++
      return neg(unary()) // повторный минус («--5») разрешён
    }
    return primary()
  }

  function primary(): Rat {
    const t = peek()
    if (!t) fail()
    if (t.kind === 'num') {
      pos++
      return t.value
    }
    if (t.kind === 'lparen') {
      pos++
      const value = expr()
      if (peek()?.kind !== 'rparen') fail() // незакрытая скобка
      pos++
      return value
    }
    fail()
  }

  const value = expr()
  if (pos !== tokens.length) fail() // хвост после законченного выражения («1 2», «1+2)»)
  return value
}

/** Точный результат ×100, округление half away from zero — только здесь, один раз. */
function toMinor(value: Rat): bigint {
  const scaled = value.n * 100n // value.d > 0
  if (scaled >= 0n) {
    return (2n * scaled + value.d) / (2n * value.d) // floor(x + 1/2)
  }
  return -((2n * -scaled + value.d) / (2n * value.d))
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** Вычисляет выражение; деньги только в целых минорных единицах, без исключений. */
export function evalExpr(input: string): EvalResult {
  try {
    const tokens = tokenize(input)
    if (tokens.length === 0) return { ok: false } // пустая/пробельная строка
    const minor = toMinor(parse(tokens))
    if (minor > MAX_SAFE || minor < -MAX_SAFE) return { ok: false }
    return { ok: true, minor: Number(minor) }
  } catch (e) {
    if (e instanceof InvalidExpression) return { ok: false }
    throw e
  }
}
