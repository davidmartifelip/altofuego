import './style.css'

// ─── DOM Elements ───
const body = document.body
const canvas = document.getElementById('flame-visualizer')
const ctx = canvas.getContext('2d')
const statusText = document.getElementById('status-text')
const ctaButton = document.getElementById('cta-button')
const micIcon = document.getElementById('mic-icon')
const spinnerIcon = document.getElementById('spinner-icon')
const hintText = document.getElementById('hint-text')
const particlesContainer = document.getElementById('particles')

// ─── State Machine ───
const STATES = {
  idle: {
    label: 'Listo para hablar',
    hint: 'Toca para reservar tu experiencia',
    className: 'state-idle',
    next: 'listening',
  },
  listening: {
    label: 'Altofuego te escucha...',
    hint: 'Toca para confirmar',
    className: 'state-listening',
    next: 'processing',
  },
  processing: {
    label: 'Procesando reserva...',
    hint: 'Un momento, por favor',
    className: 'state-processing',
    next: 'idle',
  },
}

let currentState = 'idle'

function setState(newState) {
  const state = STATES[newState]
  if (!state) return

  // Remove all state classes
  Object.values(STATES).forEach((s) => body.classList.remove(s.className))

  // Apply new state class
  body.classList.add(state.className)
  currentState = newState

  // Update text with fade
  statusText.style.opacity = '0'
  hintText.style.opacity = '0'

  setTimeout(() => {
    statusText.textContent = state.label
    hintText.textContent = state.hint
    statusText.style.opacity = '1'
    hintText.style.opacity = '1'
  }, 250)

  // Toggle icons
  if (newState === 'processing') {
    micIcon.classList.add('hidden')
    spinnerIcon.classList.remove('hidden')
  } else {
    micIcon.classList.remove('hidden')
    spinnerIcon.classList.add('hidden')
  }
}

// Initialize
setState('idle')

// Button click cycles states
ctaButton.addEventListener('click', () => {
  const next = STATES[currentState].next
  setState(next)

  // Auto-return from processing after 3s
  if (next === 'processing') {
    setTimeout(() => setState('idle'), 3000)
  }
})

// ─── Canvas: Flame Wave Visualizer ───
let animationId
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

// Simplex-like noise approximation using layered sines
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

  // State-dependent parameters
  let amplitude, speed, barCount, baseAlpha
  switch (currentState) {
    case 'listening':
      amplitude = h * 0.38
      speed = 1.8
      barCount = 64
      baseAlpha = 0.85
      break
    case 'processing':
      amplitude = h * 0.15
      speed = 0.4
      barCount = 40
      baseAlpha = 0.3
      break
    default: // idle
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
    const normalizedX = (i / barCount) * 2 - 1 // -1 to 1
    const edgeFade = 1 - Math.pow(Math.abs(normalizedX), 2.5) // Smooth falloff at edges

    const noise = flameNoise(i * 4, time)
    const barHeight = Math.abs(noise) * amplitude * edgeFade

    // Gradient based on height
    const intensity = barHeight / (amplitude * 0.8)
    const r = Math.floor(232 + (255 - 232) * intensity)
    const g = Math.floor(89 + (179 - 89) * intensity * 0.6)
    const b = Math.floor(12 + (71 - 12) * intensity * 0.3)
    const alpha = baseAlpha * edgeFade * (0.5 + intensity * 0.5)

    // Draw bar
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`

    const gap = 2
    const roundedWidth = barWidth - gap

    // Top half
    roundRect(ctx, x + gap / 2, centerY - barHeight, roundedWidth, barHeight, 2)

    // Bottom half (mirror, dimmer)
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.4})`
    roundRect(ctx, x + gap / 2, centerY, roundedWidth, barHeight * 0.6, 2)
  }

  // Glow line at center
  const gradient = ctx.createLinearGradient(0, centerY - 1, 0, centerY + 1)
  gradient.addColorStop(0, `rgba(232, 89, 12, ${baseAlpha * 0.15})`)
  gradient.addColorStop(0.5, `rgba(255, 179, 71, ${baseAlpha * 0.08})`)
  gradient.addColorStop(1, `rgba(232, 89, 12, ${baseAlpha * 0.15})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, centerY - 0.5, w, 1)

  animationId = requestAnimationFrame(drawFlameWaves)
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

  setTimeout(() => {
    particle.remove()
  }, (duration + 2) * 1000)
}

// Spawn particles periodically
function spawnParticles() {
  const count = currentState === 'listening' ? 3 : 1
  for (let i = 0; i < count; i++) {
    createParticle()
  }
}

setInterval(spawnParticles, 800)

// Initial batch
for (let i = 0; i < 8; i++) {
  setTimeout(createParticle, i * 200)
}
