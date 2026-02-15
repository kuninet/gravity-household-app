import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devPort = parseInt(env.VITE_DEV_PORT || '5173')
  const apiPort = env.VITE_API_PORT || '3001'

  return {
    plugins: [vue()],
    server: {
      host: true,
      port: devPort,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true
        }
      }
    }
  }
})
