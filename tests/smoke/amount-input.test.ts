import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AmountInput from '../../src/app/ui/AmountInput.vue'

const NBSP = '\u00A0'

describe('инпут суммы с живым предпросмотром', () => {
  it('«1500/4+200» → emitted 57500 и предпросмотр «→ 575,00»', async () => {
    const wrapper = mount(AmountInput, { props: { modelValue: null } })
    await wrapper.find('input').setValue('1500/4+200')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([57500])
    expect(wrapper.text()).toContain('→ 575,00')
  })

  it('запятая и точка равнозначны: «1,5» и «1.5» → 150', async () => {
    const wrapper = mount(AmountInput, { props: { modelValue: null } })
    const input = wrapper.find('input')

    await input.setValue('1,5')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([150])

    await input.setValue('1.5')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([150])
  })

  it('«abc» → emitted null, тихая красная подсветка, предпросмотра нет', async () => {
    const wrapper = mount(AmountInput, { props: { modelValue: null } })
    const input = wrapper.find('input')
    await input.setValue('abc')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.classes()).toContain('border-red-500')
    expect(wrapper.text()).not.toContain('→')
  })

  it('очистка до пустого → emitted null и без подсветки', async () => {
    const wrapper = mount(AmountInput, { props: { modelValue: null } })
    const input = wrapper.find('input')
    await input.setValue('1500/4+200')
    await input.setValue('')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.classes()).not.toContain('border-red-500')
    expect(wrapper.text()).not.toContain('→')
  })

  it('внешнее значение 150050 → в инпуте «1 500,50» с неразрывными пробелами', async () => {
    const wrapper = mount(AmountInput, { props: { modelValue: null } })
    await wrapper.setProps({ modelValue: 150050 })

    const value = (wrapper.find('input').element as HTMLInputElement).value
    expect(value).toBe(`1${NBSP}500,50`)
  })
})
