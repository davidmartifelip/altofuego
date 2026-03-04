/**
 * Gemini Multimodal Live API — WebSocket Client
 * Zero dependencies. Native WebSocket only.
 * Supports both API key and OAuth2 access token auth.
 */

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const MODEL = 'models/gemini-2.5-flash-native-audio-latest'

const SYSTEM_INSTRUCTION = `Eres el sumiller y recepcionista virtual de Altofuego, un restaurante especializado en brasa de alta cocina. Tu tono es sofisticado pero acogedor. Ayuda a los clientes a conocer el menú y gestionar sus reservas. Hablas perfectamente castellano.`

export class GeminiLive {
    /** @type {WebSocket | null} */
    ws = null
    connected = false

    // Callbacks
    onSetupComplete = () => { }
    onAudio = (/** @type {string} */ _base64) => { }
    onInterrupted = () => { }
    onTurnComplete = () => { }
    onError = (/** @type {string} */ _msg) => { }
    onClose = () => { }

    /**
     * Fetch an access token from the local proxy
     * @returns {Promise<string>}
     */
    async fetchToken() {
        const res = await fetch('/api/token')
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }))
            throw new Error(err.error || `Token fetch failed: ${res.status}`)
        }
        const data = await res.json()
        return data.accessToken
    }

    /**
     * Connect to the Gemini Live API
     * @param {{ apiKey?: string, accessToken?: string }} auth
     */
    connect(auth = {}) {
        return new Promise((resolve, reject) => {
            let url
            if (auth.accessToken) {
                url = `${WS_BASE}?access_token=${auth.accessToken}`
            } else if (auth.apiKey) {
                url = `${WS_BASE}?key=${auth.apiKey}`
            } else {
                reject(new Error('No authentication provided'))
                return
            }

            this.ws = new WebSocket(url)

            this.ws.onopen = () => {
                this._sendSetup()
            }

            this.ws.onmessage = (event) => {
                this._handleMessage(event)
            }

            this.ws.onerror = (e) => {
                console.error('[GeminiLive] WebSocket error:', e)
                this.onError('Error de conexión con Gemini')
                reject(e)
            }

            this.ws.onclose = (e) => {
                console.log('[GeminiLive] WebSocket closed:', e.code, e.reason)
                this.connected = false
                this.onClose()
            }

            this._connectResolve = resolve
            this._connectReject = reject
        })
    }

    /**
     * Auto-connect: fetch token from proxy, then connect
     */
    async autoConnect() {
        const accessToken = await this.fetchToken()
        return this.connect({ accessToken })
    }

    /**
     * Send the BidiGenerateContentSetup message
     */
    _sendSetup() {
        const setupMsg = {
            setup: {
                model: MODEL, // NO pongas `models/${MODEL}` aquí, ya lo tiene la constante
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Puck' // Puck es más compatible que Orus
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: SYSTEM_INSTRUCTION }]
                },
                // Activa esto para ver en la consola lo que Gemini entiende
                inputAudioTranscription: {},
                outputAudioTranscription: {}

            }
        }
        console.log('[GeminiLive] Enviant Setup...', setupMsg)
        this.ws.send(JSON.stringify(setupMsg))
    }

    /**
     * Handle incoming WebSocket messages (text or binary Blob)
     * @param {MessageEvent} event
     */
    _handleMessage(event) {
        // Gemini Live API can send messages as Blobs — read as text first
        if (event.data instanceof Blob) {
            event.data.text().then(text => this._parseMessage(text))
            return
        }
        if (event.data instanceof ArrayBuffer) {
            this._parseMessage(new TextDecoder().decode(event.data))
            return
        }
        this._parseMessage(event.data)
    }

    /**
     * Parse and dispatch a JSON message string
     * @param {string} raw
     */
    _parseMessage(raw) {
        let msg
        try {
            msg = JSON.parse(raw)
        } catch {
            console.warn('[GeminiLive] Non-JSON message:', raw?.slice?.(0, 100))
            return
        }

        // Setup complete
        if (msg.setupComplete !== undefined) {
            console.log('[GeminiLive] Setup complete')
            this.connected = true
            this.onSetupComplete()
            if (this._connectResolve) {
                this._connectResolve()
                this._connectResolve = null
            }
            return
        }

        // Server content
        if (msg.serverContent) {
            const sc = msg.serverContent

            // Interruption
            if (sc.interrupted) {
                console.log('[GeminiLive] Interrupted by user')
                this.onInterrupted()
                return
            }

            // Model audio turn
            if (sc.modelTurn && sc.modelTurn.parts) {
                for (const part of sc.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        this.onAudio(part.inlineData.data)
                    }
                }
            }

            // Input transcription
            if (sc.inputTranscription && sc.inputTranscription.text) {
                console.log('[GeminiLive] User said:', sc.inputTranscription.text)
            }

            // Output transcription
            if (sc.outputTranscription && sc.outputTranscription.text) {
                console.log('[GeminiLive] AI said:', sc.outputTranscription.text)
            }

            // Turn complete
            if (sc.turnComplete) {
                console.log('[GeminiLive] Turn complete')
                this.onTurnComplete()
            }
        }
    }

    /**
     * Send realtime audio input (base64 PCM 16kHz 16-bit mono)
     * @param {string} base64Pcm
     */
    sendAudio(base64Pcm) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const msg = {
            realtimeInput: {
                audio: {
                    data: base64Pcm,
                    mimeType: 'audio/pcm;rate=16000'
                }
            }
        }

        this.ws.send(JSON.stringify(msg))
    }

    /**
     * Send a text message as client content
     * @param {string} text
     */
    sendText(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const msg = {
            clientContent: {
                turns: [
                    {
                        role: 'user',
                        parts: [{ text }]
                    }
                ],
                turnComplete: true
            }
        }

        this.ws.send(JSON.stringify(msg))
    }

    /**
     * Disconnect
     */
    disconnect() {
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }
        this.connected = false
    }
}
