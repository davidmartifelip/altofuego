import tailwindcss from '@tailwindcss/vite'
import { geminiTokenPlugin } from './server/token-plugin.js'

export default {
  plugins: [
    tailwindcss(),
    geminiTokenPlugin(),
  ],
}
