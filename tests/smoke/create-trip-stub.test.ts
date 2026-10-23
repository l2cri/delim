import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../../src/App.vue'

describe('экран создания поездки (заглушка)', () => {
  it('показывает приложение и кнопку создания поездки', () => {
    const wrapper = mount(App)

    expect(wrapper.text()).toContain('Делим')
    expect(wrapper.text()).toContain('Поездка пока не создана')
    expect(wrapper.text()).toContain('Создать поездку')
  })

  it('кнопка создания пока неактивна — экран-заглушка', () => {
    const wrapper = mount(App)

    const button = wrapper.find('button')
    expect(button.attributes('disabled')).toBeDefined()
  })
})
