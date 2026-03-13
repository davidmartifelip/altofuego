import tailwindcss from '@tailwindcss/vite'
import { geminiTokenPlugin } from './server/token-plugin.js'
import { webhooksPlugin } from './server/webhooks-plugin.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default {
  plugins: [
    tailwindcss(),
    geminiTokenPlugin(),
    webhooksPlugin(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        menu: resolve(__dirname, 'menu.html'),
        nosotros: resolve(__dirname, 'nosotros.html'),
      }
    }
  }
}
