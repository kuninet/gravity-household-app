import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

const savedTheme = localStorage.getItem('gravity-theme')
if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark')
}

createApp(App).mount('#app')
