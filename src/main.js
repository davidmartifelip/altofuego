import './style.css'
import { GeminiLive } from './gemini-live.js'
import { AudioManager } from './audio-manager.js'
import { executeConsultarDisponibilidad, executeCrearReserva } from './reservations.js'

// ─── DOM Elements ───
const body = document.body
const canvas = document.getElementById('flame-visualizer')
const ctx = canvas.getContext('2d')
const statusText = document.getElementById('status-text')
const ctaButton = document.getElementById('cta-button')
const micIcon = document.getElementById('mic-icon')
const stopIcon = document.getElementById('stop-icon')
const spinnerIcon = document.getElementById('spinner-icon')
const hintText = document.getElementById('hint-text')
const particlesContainer = document.getElementById('particles')
const connectionStatus = document.getElementById('connection-status')

// Modal elements
const apiModal = document.getElementById('api-modal')
const apiKeyInput = document.getElementById('api-key-input')
const apiKeySubmit = document.getElementById('api-key-submit')
const apiError = document.getElementById('api-error')

// ─── Instances ───
const gemini = new GeminiLive()
const audio = new AudioManager()

// ─── State Machine ───
const STATES = {
  idle: {
    label: 'Listo para hablar',
    hint: 'Toca para iniciar conversación',
    className: 'state-idle',
  },
  connecting: {
    label: 'Conectando...',
    hint: 'Estableciendo conexión',
    className: 'state-processing',
  },
  listening: {
    label: 'Altofuego te escucha...',
    hint: 'Habla para reservar o preguntar',
    className: 'state-listening',
  },
  responding: {
    label: 'Altofuego responde...',
    hint: 'Habla para interrumpir',
    className: 'state-responding',
  },
  processing: {
    label: 'Procesando reserva...',
    hint: 'Un momento, por favor',
    className: 'state-processing',
  },
}

let currentState = 'idle'
let isSessionActive = false
let micLevel = 0
let hasProxyToken = false // Whether the server-side proxy is available
let stateTimeoutId = null

function setState(newState) {
  const state = STATES[newState]
  if (!state) return

  if (stateTimeoutId) clearTimeout(stateTimeoutId)

  // Start transition
  statusText.classList.add('is-changing')
  hintText.classList.add('is-changing')

  // Wait for the fade out (match CSS transition)
  stateTimeoutId = setTimeout(() => {
    // Update visual state classes on body to match the new text
    Object.values(STATES).forEach((s) => body.classList.remove(s.className))
    body.classList.add(state.className)
    currentState = newState

    statusText.textContent = state.label
    hintText.textContent = state.hint

    // Tiny delay to ensure text and styles are swapped before fading back in
    requestAnimationFrame(() => {
      statusText.classList.remove('is-changing')
      hintText.classList.remove('is-changing')
    })
  }, 300)

  micIcon.classList.add('hidden')
  stopIcon.classList.add('hidden')
  spinnerIcon.classList.add('hidden')

  switch (newState) {
    case 'idle':
      micIcon.classList.remove('hidden')
      break
    case 'connecting':
    case 'processing':
      spinnerIcon.classList.remove('hidden')
      break
    case 'listening':
    case 'responding':
      stopIcon.classList.remove('hidden')
      break
  }
}

// ─── API Key Management (fallback) ───
const API_KEY_STORAGE = 'altofuego_gemini_key'

function getStoredApiKey() {
  return localStorage.getItem(API_KEY_STORAGE)
}

function storeApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key)
}

function showModal() {
  apiModal.classList.remove('hidden')
  const stored = getStoredApiKey()
  if (stored) apiKeyInput.value = stored
  setTimeout(() => apiKeyInput.focus(), 300)
}

function hideModal() {
  apiModal.classList.add('hidden')
}

function showApiError(msg) {
  apiError.textContent = msg
  apiError.classList.remove('hidden')
}

function hideApiError() {
  apiError.classList.add('hidden')
}

// ─── Connection Flow ───
function wireGeminiCallbacks() {
  gemini.onSetupComplete = () => {
    console.log('[App] Gemini session ready')
    connectionStatus.style.opacity = '1'
  }

  gemini.onAudio = (base64) => {
    if (currentState === 'listening') {
      setState('responding')
    }
    audio.playAudio(base64)
  }

  gemini.onInterrupted = () => {
    console.log('[App] Barge-in: stopping playback')
    audio.stopPlayback()
    setState('listening')
  }

  gemini.onTurnComplete = () => {
    if (isSessionActive) {
      setState('listening')
    }
  }

  gemini.onToolCall = async ({ id, name, args }) => {
    console.log('[App] Tool call:', name, args)
    setState('processing')

    let result
    try {
      if (name === 'consultar_disponibilidad') {
        result = await executeConsultarDisponibilidad(args)
      } else if (name === 'crear_reserva') {
        result = await executeCrearReserva(args)
      } else {
        result = { error: `Función desconocida: ${name}` }
      }
    } catch (err) {
      console.error('[App] Tool execution error:', err)
      result = { error: 'Error interno al ejecutar la función.' }
    }

    // Send result back to Gemini
    gemini.sendToolResponse(id, name, result)

    // Return to listening state (Gemini will speak the response)
    if (isSessionActive) setState('listening')
  }

  gemini.onError = (msg) => {
    console.error('[App] Gemini error:', msg)
    endSession()
    if (!hasProxyToken) {
      showApiError(msg)
      showModal()
    }
  }

  gemini.onClose = () => {
    console.log('[App] Gemini connection closed')
    connectionStatus.style.opacity = '0'
    if (isSessionActive) {
      endSession()
    }
  }
}

async function startSession(auth) {
  setState('connecting')
  hideApiError()

  try {
    wireGeminiCallbacks()

    if (auth.auto) {
      await gemini.autoConnect()
    } else {
      await gemini.connect(auth)
    }

    hideModal()

    // Start mic
    audio.onAudioData = (base64Pcm) => {
      gemini.sendAudio(base64Pcm)
    }
    audio.onMicLevel = (level) => {
      micLevel = level
    }

    await audio.startMic()
    isSessionActive = true
    setState('listening')

  } catch (err) {
    console.error('[App] Connection failed:', err)
    setState('idle')

    if (auth.auto) {
      // Proxy failed — fall back to manual API key
      console.log('[App] Proxy auth failed, falling back to API key modal')
      hasProxyToken = false
      showApiError('Conexión automática fallida. Introduce una API Key.')
      showModal()
    } else {
      showApiError('No se pudo conectar. Verifica tu API Key.')
      showModal()
    }
  }
}

function endSession() {
  isSessionActive = false
  audio.disconnect()
  gemini.disconnect()
  connectionStatus.style.opacity = '0'
  micLevel = 0
  setState('idle')
}

// ─── Check if proxy is available ───
async function checkProxy() {
  try {
    const res = await fetch('/api/token', { method: 'GET' })
    if (res.ok) {
      hasProxyToken = true
      console.log('[App] Token proxy available — auto-auth enabled')
    }
  } catch {
    hasProxyToken = false
    console.log('[App] Token proxy not available — manual API key required')
  }
}

// ─── Event Handlers ───

// Modal submit
apiKeySubmit.addEventListener('click', () => {
  const key = apiKeyInput.value.trim()
  if (!key) {
    showApiError('Introduce una API Key válida')
    return
  }
  storeApiKey(key)
  startSession({ apiKey: key })
})

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') apiKeySubmit.click()
})

// CTA Button
ctaButton.addEventListener('click', () => {
  if (currentState === 'idle') {
    if (hasProxyToken) {
      startSession({ auto: true })
    } else {
      const key = getStoredApiKey()
      if (key) {
        startSession({ apiKey: key })
      } else {
        showModal()
      }
    }
  } else if (isSessionActive) {
    endSession()
  }
})

// ─── Initialize ───
setState('idle')

// Check proxy availability, then decide UI
checkProxy().then(() => {
  if (hasProxyToken) {
    // Proxy available — hide modal, ready to go
    hideModal()
  } else if (!getStoredApiKey()) {
    showModal()
  } else {
    hideModal()
  }
})

// ─── Canvas: Flame Wave Visualizer ───
let time = 0

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
}

window.addEventListener('resize', resizeCanvas)
resizeCanvas()

function flameNoise(x, t) {
  return (
    Math.sin(x * 0.02 + t * 0.8) * 0.5 +
    Math.sin(x * 0.035 + t * 1.2) * 0.3 +
    Math.sin(x * 0.05 + t * 2.0) * 0.15 +
    Math.sin(x * 0.08 + t * 0.5) * 0.05
  )
}

function drawFlameWaves() {
  const w = canvas.getBoundingClientRect().width
  const h = canvas.getBoundingClientRect().height

  ctx.clearRect(0, 0, w, h)

  let amplitude, speed, barCount, baseAlpha
  switch (currentState) {
    case 'listening':
      amplitude = h * (0.2 + micLevel * 2.5)
      speed = 1.5 + micLevel * 3
      barCount = 64
      baseAlpha = 0.6 + micLevel * 0.4
      break
    case 'responding':
      amplitude = h * 0.35
      speed = 1.6
      barCount = 64
      baseAlpha = 0.75
      break
    case 'processing':
    case 'connecting':
      amplitude = h * 0.15
      speed = 0.4
      barCount = 40
      baseAlpha = 0.3
      break
    default:
      amplitude = h * 0.22
      speed = 0.7
      barCount = 48
      baseAlpha = 0.5
  }

  time += 0.016 * speed

  const barWidth = w / barCount
  const centerY = h / 2

  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth
    const normalizedX = (i / barCount) * 2 - 1
    const edgeFade = 1 - Math.pow(Math.abs(normalizedX), 2.5)

    const noise = flameNoise(i * 4, time)
    const barHeight = Math.abs(noise) * amplitude * edgeFade

    const intensity = barHeight / (amplitude * 0.8)
    const r = Math.floor(232 + (255 - 232) * intensity)
    const g = Math.floor(89 + (179 - 89) * intensity * 0.6)
    const b = Math.floor(12 + (71 - 12) * intensity * 0.3)
    const alpha = baseAlpha * edgeFade * (0.5 + intensity * 0.5)

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`
    const gap = 2
    const roundedWidth = barWidth - gap
    roundRect(ctx, x + gap / 2, centerY - barHeight, roundedWidth, barHeight, 2)

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`
    roundRect(ctx, x + gap / 2, centerY, roundedWidth, barHeight * 0.6, 2)
  }

  const gradient = ctx.createLinearGradient(0, centerY - 1, 0, centerY + 1)
  gradient.addColorStop(0, `rgba(232, 89, 12, ${baseAlpha * 0.15})`)
  gradient.addColorStop(0.5, `rgba(255, 179, 71, ${baseAlpha * 0.08})`)
  gradient.addColorStop(1, `rgba(232, 89, 12, ${baseAlpha * 0.15})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, centerY - 0.5, w, 1)

  requestAnimationFrame(drawFlameWaves)
}

function roundRect(ctx, x, y, width, height, radius) {
  if (width < 0 || height < 0) return
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
  ctx.fill()
}

drawFlameWaves()

// ─── Ambient Particles ───
function createParticle() {
  const particle = document.createElement('div')
  particle.classList.add('particle')
  const size = Math.random() * 3 + 1
  particle.style.width = `${size}px`
  particle.style.height = `${size}px`
  particle.style.left = `${Math.random() * 100}%`
  particle.style.bottom = '-10px'
  particle.style.setProperty('--drift', `${(Math.random() - 0.5) * 80}px`)
  const duration = Math.random() * 8 + 6
  particle.style.animationDuration = `${duration}s`
  particle.style.animationDelay = `${Math.random() * 2}s`
  particlesContainer.appendChild(particle)
  setTimeout(() => particle.remove(), (duration + 2) * 1000)
}

function spawnParticles() {
  const count = currentState === 'listening' || currentState === 'responding' ? 3 : 1
  for (let i = 0; i < count; i++) createParticle()
}

setInterval(spawnParticles, 800)
for (let i = 0; i < 8; i++) setTimeout(createParticle, i * 200)
