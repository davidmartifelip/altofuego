import tailwindcss from '@tailwindcss/vite'
import { geminiTokenPlugin } from './server/token-plugin.js'
import { webhooksPlugin } from './server/webhooks-plugin.js'
import { retellPlugin } from './server/retell-plugin.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default {
  plugins: [
    tailwindcss(),
    geminiTokenPlugin(),
    webhooksPlugin(),
    retellPlugin(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        asistente: resolve(__dirname, 'asistente.html'),
        menu: resolve(__dirname, 'menu.html'),
        nosotros: resolve(__dirname, 'nosotros.html'),
      }
    }
  }
}
