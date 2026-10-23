import { describe, expect, it } from 'vitest'
import { parseRate } from './index'

// Тесты идут через публичный интерфейс ядра: parseRate и ParseRateResult.
// Курс — точное рациональное num/den (ADR 0004); вход — десятичная дробь,
// какой её вводят в настройках валют (ADR 0005).

/** НОД для проверки несократимости результата. */
function gcd(a: number, b: number): number {
  while (b > 0) {
    const r = a % b
    a = b
    b = r
  }
  return a
}

/** Ожидаемый удачный разбор. */
function rate(num: number, den: number) {
  return { ok: true, rate: { num, den } }
}

describe('parseRate — десятичная дробь в точное рациональное', () => {
  it('целое «3» → 3/1', () => {
    expect(parseRate('3')).toEqual(rate(3, 1))
  })

  it('«29,5» → 59/2', () => {
    expect(parseRate('29,5')).toEqual(rate(59, 2))
  })

  it('«0.85» → 17/20', () => {
    expect(parseRate('0.85')).toEqual(rate(17, 20))
  })

  it('«2,50» → 5/2, а не 250/100 — результат несократимый', () => {
    expect(parseRate('2,50')).toEqual(rate(5, 2))
  })

  it('«,5» без целой части → 1/2', () => {
    expect(parseRate(',5')).toEqual(rate(1, 2))
  })

  it('«3.» без дробной части → 3/1', () => {
    expect(parseRate('3.')).toEqual(rate(3, 1))
  })

  it('« 7 » обрезается по пробелам → 7/1', () => {
    expect(parseRate(' 7 ')).toEqual(rate(7, 1))
  })
})

describe('parseRate — запятая и точка равнозначны', () => {
  it('«29,5» и «29.5» дают одно рациональное', () => {
    expect(parseRate('29.5')).toEqual(parseRate('29,5'))
  })

  it('«0,85» и «0.85» дают одно рациональное', () => {
    expect(parseRate('0,85')).toEqual(parseRate('0.85'))
  })
})

describe('parseRate — результат несократим', () => {
  it('НОД(num, den) = 1 на наборе входов', () => {
    const inputs = ['3', '29,5', '0.85', '2,50', ',5', '0,123456789012345', '1801439850948198,2']
    for (const input of inputs) {
      const result = parseRate(input)
      expect(result.ok).toBe(true)
      if (result.ok) expect(gcd(result.rate.num, result.rate.den)).toBe(1)
    }
  })
})

describe('parseRate — некорректный ввод: ok:false без исключений', () => {
  it.each([
    [''], // пустая строка
    ['   '], // только пробелы
    ['abc'], // мусор
    ['-3'], // знак
    ['+3'], // знак
    ['1/2'], // выражение
    ['1 000'], // пробел внутри
    [','], // разделитель без единственной цифры
    ['.'], // разделитель без единственной цифры
    ['1,2,3'], // второй разделитель
    ['1.2.3'], // второй разделитель
  ])('«%s» — отказ', (input) => {
    expect(parseRate(input)).toEqual({ ok: false })
  })
})

describe('parseRate — курс строго положительный', () => {
  it.each([
    ['0'],
    ['0,0'],
    [',00'],
    ['0,000'],
    ['0.00'],
  ])('«%s» — отказ', (input) => {
    expect(parseRate(input)).toEqual({ ok: false })
  })
})

describe('parseRate — дробная часть не длиннее 15 цифр', () => {
  it('ровно 15 цифр — успех: «0,123456789012345» → 24691357802469/200000000000000', () => {
    expect(parseRate('0,123456789012345')).toEqual(rate(24691357802469, 200000000000000))
  })

  it('16 цифр — отказ: «0,1234567890123456»', () => {
    expect(parseRate('0,1234567890123456')).toEqual({ ok: false })
  })
})

describe('parseRate — граница безопасного целого', () => {
  it('«9007199254740991» (MAX_SAFE) → 9007199254740991/1', () => {
    expect(parseRate('9007199254740991')).toEqual(rate(Number.MAX_SAFE_INTEGER, 1))
  })

  it('«9007199254740992» (MAX_SAFE + 1) — отказ', () => {
    expect(parseRate('9007199254740992')).toEqual({ ok: false })
  })

  it('«9999999999999999» (16 цифр) — отказ', () => {
    expect(parseRate('9999999999999999')).toEqual({ ok: false })
  })

  it('сокращение спасает: «1801439850948198,2» → 9007199254740991/5', () => {
    // 18014398509481982/10 больше MAX_SAFE, но после сокращения на 2 — безопасно
    expect(parseRate('1801439850948198,2')).toEqual(rate(Number.MAX_SAFE_INTEGER, 5))
  })
})
