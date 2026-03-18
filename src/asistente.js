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
const errorModal = document.getElementById('error-modal')
const errorMessage = document.getElementById('error-message')
const errorClose = document.getElementById('error-close')

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
let stateTimeoutId = null
let inactivityTimer = null

const resetInactivityTimer = () => {
  if (inactivityTimer) clearTimeout(inactivityTimer)
  inactivityTimer = setTimeout(() => {
    console.log('[App] 15s Inactivity timeout reached.')
    endSession()
  }, 50000)
}

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

// ─── Error Modal Handling ───

function showErrorModal(msg) {
  if (msg) errorMessage.textContent = msg
  errorModal.classList.remove('hidden')
}

function hideErrorModal() {
  errorModal.classList.add('hidden')
}

// ─── Connection Flow ───
function wireGeminiCallbacks() {
  gemini.onSetupComplete = () => {
    console.log('[App] Gemini session ready')
    connectionStatus.style.opacity = '1'
  }


  gemini.onAudio = (base64) => {
    if (!isSessionActive) return
    if (currentState !== 'responding') {
      setState('responding')
    }
    resetInactivityTimer() // AI is speaking, reset timer
    audio.playAudio(base64)
  }

  gemini.onInterrupted = () => {
    console.log('[App] Barge-in: stopping playback')
    audio.stopPlayback()
    setState('listening')
    resetInactivityTimer() // User interrupted, reset timer
  }

  gemini.onTurnComplete = () => {
    if (isSessionActive) {
      setState('listening')
      resetInactivityTimer()
    }
  }

  gemini.onToolCall = async ({ id, name, args }) => {
    console.log('[App] Tool call:', name, args)

    if (name === 'finalizar_llamada') {
      console.log('[App] AI requested to hang up. Waiting for audio to finish...')
      gemini.sendToolResponse(id, name, { success: true })

      const waitForAudioAndEnd = () => {
        if (audio.isPlaying && isSessionActive) {
          // Keep waiting
          setTimeout(waitForAudioAndEnd, 100)
        } else {
          // Audio finished or session already ended
          if (isSessionActive) endSession()
        }
      }

      // Give a tiny head start to let the first chunk start playing if it just arrived
      setTimeout(waitForAudioAndEnd, 500)
      return
    }

    setState('processing')
    resetInactivityTimer()

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
    if (isSessionActive) {
      setState('listening')
      resetInactivityTimer()
    }
  }

  gemini.onError = (msg) => {
    console.error('[App] Gemini error:', msg)
    endSession()
    showErrorModal('Se ha perdido la conexión de audio con el asistente. Comprueba tu red.')
  }

  gemini.onClose = () => {
    console.log('[App] Gemini connection closed')
    connectionStatus.style.opacity = '0'
    if (isSessionActive) {
      endSession()
    }
  }
}

async function startSession() {
  setState('connecting')
  hideErrorModal()

  try {
    wireGeminiCallbacks()

    await gemini.autoConnect()

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
    resetInactivityTimer()

  } catch (err) {
    console.error('[App] Connection failed:', err)
    setState('idle')
    showErrorModal('No se ha podido conectar con el asistente. Por favor, desactiva tu bloqueador de anuncios o VPN si tienes alguno activo, y recarga la página.')
  }
}

function endSession() {
  isSessionActive = false
  if (inactivityTimer) clearTimeout(inactivityTimer)
  audio.disconnect()
  gemini.disconnect()
  connectionStatus.style.opacity = '0'
  micLevel = 0
  setState('idle')
}

// ─── Event Handlers ───

// Modal close
errorClose.addEventListener('click', hideErrorModal)

// CTA Button
ctaButton.addEventListener('click', () => {
  if (currentState === 'idle') {
    startSession()
  } else if (isSessionActive) {
    endSession()
  }
})

// ─── Initialize ───
setState('idle')

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

// Show body once everything is ready
document.body.style.opacity = '1'
