import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { evalExpr, type EvalResult } from './calculator'

// Property-слой калькулятора: для случайных корректных выражений результат
// evalExpr совпадает с эталонным вычислением «в лоб». Схема: сгенерировать AST
// (числа до ~9 цифр с дробной частью, + − * /, унарный минус, глубина ≤ 4),
// отрендерить строкой — скобки только необходимые по приоритету и
// левоассоциативности, иногда избыточные, разделитель дробной части случайно
// '.' или ',', между токенами иногда пробел — и сверить с независимым
// эталоном: точные рациональные bigint, округление ×100 half away from zero,
// выход за MAX_SAFE и деление на ноль → ok:false. Тест идёт только через
// публичный интерфейс ядра: evalExpr и EvalResult.

// Единый сид тикета: прогоны детерминированы, падение воспроизводимо.
// Другой сид: DELIM_FC_SEED=12345 npx vitest run src/core/calculator.property.test.ts
const SEED = Number(process.env.DELIM_FC_SEED ?? 20261024)

/** Дробная часть — всегда 4 цифры: значение = (int·10^4 + frac)/10^4 точно. */
const FRAC_DIGITS = 4

type BinOp = '+' | '-' | '*' | '/'

/**
 * AST выражения: лист — число (int до 9 цифр, дробная часть 4 цифры, свой
 * разделитель для рендера); узел — бинарная операция (wrap — избыточные скобки
 * вокруг подвыражения) или унарный минус.
 */
type Ast =
  | { kind: 'num'; int: number; frac: number; sep: '.' | ',' }
  | { kind: 'op'; op: BinOp; left: Ast; right: Ast; wrap: boolean }
  | { kind: 'neg'; arg: Ast }

const leafArb: fc.Arbitrary<Ast> = fc
  .record({
    int: fc.integer({ min: 0, max: 10 ** 9 - 1 }),
    frac: fc.nat(10 ** FRAC_DIGITS - 1),
    sep: fc.constantFrom<'.' | ','>('.', ','),
  })
  .map(({ int, frac, sep }) => ({ kind: 'num' as const, int, frac, sep }))

/** Листья с перевесом против глубоких деревьев — арифметика в основном мелкая. */
function astArb(depth: number): fc.Arbitrary<Ast> {
  if (depth === 0) return leafArb
  const opArb: fc.Arbitrary<Ast> = fc
    .record({
      op: fc.constantFrom<BinOp>('+', '-', '*', '/'),
      left: astArb(depth - 1),
      right: astArb(depth - 1),
      wrap: fc.nat(3).map((n) => n === 0), // ~25% узлов — избыточные скобки
    })
    .map(({ op, left, right, wrap }) => ({ kind: 'op' as const, op, left, right, wrap }))
  const negArb: fc.Arbitrary<Ast> = astArb(depth - 1).map((arg) => ({ kind: 'neg' as const, arg }))
  return fc.oneof(leafArb, leafArb, opArb, negArb)
}

function precedence(op: BinOp): number {
  return op === '+' || op === '-' ? 1 : 2
}

/**
 * Рендер AST в поток токенов. Скобки — минимально необходимые:
 * - левый потомок — в скобках, если его приоритет строго ниже операции
 *   (равный не требует: левоассоциативность разбирает a−b−c как (a−b)−c);
 * - правый потомок — в скобках, если приоритет не выше операции
 *   (a−(b+c) и a/(b*c) без скобок читались бы иначе; для a+(b+c) и a*(b/c)
 *   скобки избыточны по ассоциативности — рендер ставит их для простоты
 *   правила, что разрешено контрактом «иногда избыточные»);
 * - потомок-операция под унарным минусом — всегда в скобках; neg и числа
 *   скобок не требуют («--5», «3*-2» разбираются грамматикой).
 */
function renderTokens(node: Ast): string[] {
  switch (node.kind) {
    case 'num': {
      const frac = String(node.frac).padStart(FRAC_DIGITS, '0')
      return [`${node.int}${node.sep}${frac}`]
    }
    case 'neg': {
      const inner = renderTokens(node.arg)
      return node.arg.kind === 'op' ? ['-', '(', ...inner, ')'] : ['-', ...inner]
    }
    case 'op': {
      const left =
        node.left.kind === 'op' && precedence(node.left.op) < precedence(node.op)
          ? ['(', ...renderTokens(node.left), ')']
          : renderTokens(node.left)
      const right =
        node.right.kind === 'op' && precedence(node.right.op) <= precedence(node.op)
          ? ['(', ...renderTokens(node.right), ')']
          : renderTokens(node.right)
      const tokens = [...left, node.op, ...right]
      return node.wrap ? ['(', ...tokens, ')'] : tokens
    }
  }
}

/** Эталонное рациональное значение: n/d, d > 0; сокращение не нужно — важно отношение. */
interface Rat {
  n: bigint
  d: bigint
}

function makeRat(n: bigint, d: bigint): Rat {
  return d < 0n ? { n: -n, d: -d } : { n, d }
}

/**
 * Независимое вычисление AST на точных рациональных bigint: null — деление
 * на ноль. Написано здесь, без опоры на приватную арифметику calculator.ts.
 */
function evalAst(node: Ast): Rat | null {
  switch (node.kind) {
    case 'num': {
      const digits = `${node.int}${String(node.frac).padStart(FRAC_DIGITS, '0')}`
      return { n: BigInt(digits), d: 10n ** BigInt(FRAC_DIGITS) }
    }
    case 'neg': {
      const value = evalAst(node.arg)
      return value === null ? null : { n: -value.n, d: value.d }
    }
    case 'op': {
      const a = evalAst(node.left)
      if (a === null) return null
      const b = evalAst(node.right)
      if (b === null) return null
      switch (node.op) {
        case '+':
          return makeRat(a.n * b.d + b.n * a.d, a.d * b.d)
        case '-':
          return makeRat(a.n * b.d - b.n * a.d, a.d * b.d)
        case '*':
          return makeRat(a.n * b.n, a.d * b.d)
        case '/':
          return b.n === 0n ? null : makeRat(a.n * b.d, a.d * b.n)
      }
    }
  }
}

/** ×100 half away from zero на рациональном: floor(|n|·100/d + 1/2) со знаком. */
function toMinor(value: Rat): bigint {
  const scaled = value.n * 100n
  const sign = scaled < 0n ? -1n : 1n
  const mag = scaled < 0n ? -scaled : scaled
  const q = (2n * mag + value.d) / (2n * value.d)
  return sign * q
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** Ожидаемый EvalResult: за пределами безопасных целых — ok:false. */
function expected(node: Ast): EvalResult {
  const value = evalAst(node)
  if (value === null) return { ok: false }
  const minor = toMinor(value)
  if (minor > MAX_SAFE || minor < -MAX_SAFE) return { ok: false }
  return { ok: true, minor: Number(minor) }
}

describe('property-инварианты калькулятора (парсер против рационального эталона)', () => {
  it('evalExpr(строка) глубоким равенством совпадает с эталоном, включая ok:false исходы', () => {
    fc.assert(
      fc.property(astArb(4), fc.array(fc.boolean(), { maxLength: 64 }), (ast, spaces) => {
        const tokens = renderTokens(ast)
        const source = tokens
          .map((token, i) => (i > 0 && spaces[i % spaces.length] ? ` ${token}` : token))
          .join('')
        expect(source.length, 'рендер не должен давать пустую строку').toBeGreaterThan(0)
        expect(
          evalExpr(source),
          `строка «${source}» из AST ${JSON.stringify(ast)}`,
        ).toStrictEqual(expected(ast))
      }),
      { seed: SEED, numRuns: 500 },
    )
  })
})
