/**
 * Audio Manager — Mic capture (16kHz) & Playback (24kHz)
 * Uses Web Audio API + AudioWorklet for low-latency processing.
 * Zero dependencies.
 */

// ─── PCM Worklet Processor (inline) ───
const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const samples = input[0];
      // Convert Float32 [-1,1] to Int16
      const pcm16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`

export class AudioManager {
    /** @type {AudioContext | null} */
    captureCtx = null
    /** @type {AudioContext | null} */
    playbackCtx = null
    /** @type {MediaStream | null} */
    micStream = null
    /** @type {AudioWorkletNode | null} */
    workletNode = null

    // Playback queue
    /** @type {AudioBufferSourceNode[]} */
    playbackSources = []
    playbackTime = 0
    isPlaying = false

    // Callbacks
    onAudioData = (/** @type {string} */ _base64) => { }
    onMicLevel = (/** @type {number} */ _level) => { }

    /**
     * Start microphone capture at 16kHz
     * Calls onAudioData with base64-encoded PCM chunks
     */
    async startMic() {
        // Request mic access
        this.micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        })

        // Create capture context at 16kHz
        this.captureCtx = new AudioContext({ sampleRate: 16000 })

        // Register worklet from blob
        const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
        const workletUrl = URL.createObjectURL(blob)
        await this.captureCtx.audioWorklet.addModule(workletUrl)
        URL.revokeObjectURL(workletUrl)

        // Connect mic → worklet
        const source = this.captureCtx.createMediaStreamSource(this.micStream)
        this.workletNode = new AudioWorkletNode(this.captureCtx, 'pcm-processor')

        // Listen for PCM data
        this.workletNode.port.onmessage = (e) => {
            const pcmBuffer = e.data // ArrayBuffer of Int16
            const base64 = this._arrayBufferToBase64(pcmBuffer)
            this.onAudioData(base64)

            // Calculate mic level for visualizer
            const view = new Int16Array(pcmBuffer)
            let sum = 0
            for (let i = 0; i < view.length; i++) {
                sum += Math.abs(view[i])
            }
            const avg = sum / view.length / 32768
            this.onMicLevel(avg)
        }

        source.connect(this.workletNode)
        this.workletNode.connect(this.captureCtx.destination) // Needed to keep processing alive
    }

    /**
     * Stop microphone
     */
    stopMic() {
        if (this.workletNode) {
            this.workletNode.disconnect()
            this.workletNode = null
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop())
            this.micStream = null
        }
        if (this.captureCtx) {
            this.captureCtx.close()
            this.captureCtx = null
        }
    }

    /**
     * Initialize the playback context (24kHz for Gemini output)
     */
    _ensurePlaybackCtx() {
        if (!this.playbackCtx || this.playbackCtx.state === 'closed') {
            this.playbackCtx = new AudioContext({ sampleRate: 24000 })
        }
    }

    /**
     * Enqueue audio for gapless playback
     * @param {string} base64Pcm — Base64-encoded 16-bit PCM at 24kHz
     */
    playAudio(base64Pcm) {
        this._ensurePlaybackCtx()

        const pcmBytes = atob(base64Pcm)
        const pcmArray = new Int16Array(pcmBytes.length / 2)
        for (let i = 0; i < pcmArray.length; i++) {
            pcmArray[i] = pcmBytes.charCodeAt(i * 2) | (pcmBytes.charCodeAt(i * 2 + 1) << 8)
        }

        // Convert Int16 to Float32
        const float32 = new Float32Array(pcmArray.length)
        for (let i = 0; i < pcmArray.length; i++) {
            float32[i] = pcmArray[i] / 32768
        }

        // Create audio buffer
        const buffer = this.playbackCtx.createBuffer(1, float32.length, 24000)
        buffer.copyToChannel(float32, 0)

        // Schedule for gapless playback
        const source = this.playbackCtx.createBufferSource()
        source.buffer = buffer

        // Gain node for smooth stop
        const gainNode = this.playbackCtx.createGain()
        source.connect(gainNode)
        gainNode.connect(this.playbackCtx.destination)

        // Track sources for interruption
        this.playbackSources.push(source)

        source.onended = () => {
            const idx = this.playbackSources.indexOf(source)
            if (idx !== -1) this.playbackSources.splice(idx, 1)
            if (this.playbackSources.length === 0) {
                this.isPlaying = false
            }
        }

        // Schedule at the right time for gapless
        const now = this.playbackCtx.currentTime
        const startTime = Math.max(now, this.playbackTime)
        source.start(startTime)
        this.playbackTime = startTime + buffer.duration
        this.isPlaying = true
    }

    /**
     * Immediately stop all playback (barge-in)
     */
    stopPlayback() {
        for (const source of this.playbackSources) {
            try {
                source.stop(0)
            } catch {
                // Already stopped
            }
        }
        this.playbackSources = []
        this.playbackTime = 0
        this.isPlaying = false
    }

    /**
     * Full cleanup
     */
    disconnect() {
        this.stopMic()
        this.stopPlayback()
        if (this.playbackCtx && this.playbackCtx.state !== 'closed') {
            this.playbackCtx.close()
            this.playbackCtx = null
        }
    }

    /**
     * Convert ArrayBuffer to Base64
     * @param {ArrayBuffer} buffer
     * @returns {string}
     */
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i])
        }
        return btoa(binary)
    }
}
