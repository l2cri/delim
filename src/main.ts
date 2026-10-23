import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import './assets/main.css'

registerSW()

createApp(App).mount('#app')
