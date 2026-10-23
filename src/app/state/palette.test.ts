import { describe, expect, it } from 'vitest'
import { PALETTE_COLORS, PALETTE_EMOJI, pickLeastUsed, pickLeastUsedRandom } from './palette'

const C = PALETTE_COLORS

describe('палитры', () => {
  it('цвета и эмодзи — по 16 различимых значений', () => {
    expect(new Set(PALETTE_COLORS).size).toBe(16)
    expect(new Set(PALETTE_EMOJI).size).toBe(16)
  })
})

describe('pickLeastUsed: автоподбор при добавлении', () => {
  it('при свободных значениях берёт первое свободное по порядку палитры', () => {
    expect(pickLeastUsed(C, [])).toBe(C[0])
    expect(pickLeastUsed(C, [C[0]])).toBe(C[1])
    expect(pickLeastUsed(C, [C[1], C[0]])).toBe(C[2])
  })

  it('при полностью занятой палитре берёт первое наименее используемое', () => {
    const usedOnce = [...C.slice(1), C[0]]
    expect(pickLeastUsed(C, usedOnce)).toBe(C[0])
    expect(pickLeastUsed(C, [...usedOnce, C[0]])).toBe(C[1])
  })

  it('повторы считаются: наименее используемое выигрывает у первого занятого', () => {
    expect(pickLeastUsed(C, [C[0], C[0], C[1]])).toBe(C[2])
  })
})

describe('pickLeastUsedRandom: перегенерация аватара', () => {
  it('при свободных значениях всегда выдаёт свободное значение, отличное от исключённого', () => {
    const used = [C[0], C[1], C[2]]
    for (let i = 0; i < 50; i++) {
      const picked = pickLeastUsedRandom(C, used, C[0])
      expect(C.slice(3)).toContain(picked)
      expect(picked).not.toBe(C[0])
    }
  })

  it('серия перегенераций не пинг-понгит между двумя значениями', () => {
    // Компания из трёх: «наш» участник плюс двое с фиксированными цветами.
    const others = [C[1], C[2]]
    const results = new Set<string>()
    let current = C[0]
    for (let i = 0; i < 12; i++) {
      current = pickLeastUsedRandom(C, [current, ...others], current)
      results.add(current)
    }
    expect(results.size).toBeGreaterThanOrEqual(3)
  })

  it('без свободных значений выбирает среди наименее используемых', () => {
    const palette = ['#a', '#b', '#c', '#d']
    const used = ['#a', '#a', '#b', '#c', '#d']
    for (let i = 0; i < 20; i++) {
      expect(['#b', '#c', '#d']).toContain(pickLeastUsedRandom(palette, used, '#a'))
    }
  })

  it('палитра из одного значения при исключении возвращает его же', () => {
    expect(pickLeastUsedRandom(['#x'], ['#x'], '#x')).toBe('#x')
  })
})
