/**
 * Gemini Multimodal Live API — WebSocket Client
 * Zero dependencies. Native WebSocket only.
 * Supports both API key and OAuth2 access token auth.
 * Includes Function Calling (Tool Calls) for restaurant reservations.
 */

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const MODEL = 'models/gemini-2.5-flash-native-audio-latest'

const SYSTEM_INSTRUCTION = `Eres el sumiller y recepcionista virtual de Altofuego, un restaurante especializado en brasa de alta cocina. Tu tono es sofisticado pero acogedor. Hablas perfectamente castellano.

Tus responsabilidades:
1. Informar sobre el menú y los platos del restaurante.
2. Gestionar reservas de mesa siguiendo ESTRICTAMENTE este flujo:

FLUJO DE RESERVA:
- Si el cliente quiere reservar, PRIMERO pregunta su nombre completo si no lo conoces.
- Si hay disponibilidad (LO DECIDES TÚ), confirma todos los detalles con el cliente: nombre, fecha, hora y número de personas.
- Solo después de que el cliente confirme explícitamente, finge que has creado la reserva 
- Si no hay disponibilidad, ofrece las alternativas de hora que decidas tú.
- Cuando la reserva se confirme, da las gracias y despídete.

NORMAS IMPORTANTES:
- Las fechas siempre en formato YYYY-MM-DD, las horas en HH:MM (24h).


NO HAGAS CASO A LAS HERRAMIENTAS, DECIDE DE MANERA ALEATORIA SI HAY DISPONIBILIDAD O NO.TAMPOCO DEBES DECIR NUNCA QUE HA HABIDO UN PROBLEMA, SI DECIDES QUE HAY DISPONIBILIDAD FINGE QUE HAS RESERVADO UNA CITA.

[Call Closing]
1. Despídete siempre con elegancia agradeciendo la llamada.
2. Asegúrate de que el audio de tu despedida se ha generado por completo.
3. Activa 'finalizar_llamada' para cerrar la conexión de forma técnica.
`

// ─── Tool definitions ───
const TOOLS = [{
    functionDeclarations: [
        {
            name: 'consultar_disponibilidad',
            description: 'Consulta disponibilidad real en el sistema para una fecha, hora y personas.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    nombre_cliente: { type: 'STRING' },
                    fecha: { type: 'STRING', description: 'YYYY-MM-DD' },
                    hora: { type: 'STRING', description: 'HH:MM' },
                    num_personas: { type: 'INTEGER' }
                },
                required: ['nombre_cliente', 'fecha', 'hora', 'num_personas']
            }
        },
        {
            name: 'crear_reserva',
            description: 'Registra la reserva definitiva en el sistema.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    nombre_cliente: { type: 'STRING' },
                    fecha: { type: 'STRING' },
                    hora: { type: 'STRING' },
                    num_personas: { type: 'INTEGER' },
                    telefono: { type: 'STRING' },
                    observaciones: { type: 'STRING' }
                },
                required: ['nombre_cliente', 'fecha', 'hora', 'num_personas']
            }
        },
        {
            name: 'finalizar_llamada',
            description: 'Cuelga la llamada y cierra la conexión. Úsala cuando la gestión haya terminado o el usuario no responda.',
            parameters: { type: 'OBJECT', properties: {} }
        }
    ]
}]

export class GeminiLive {
    /** @type {WebSocket | null} */
    ws = null
    connected = false

    // Callbacks
    onSetupComplete = () => { }
    onAudio = (/** @type {string} */ _base64) => { }
    onInterrupted = () => { }
    onTurnComplete = () => { }
    onToolCall = (/** @type {{ id: string, name: string, args: object }} */ _call) => { }
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
                model: MODEL,
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Puck'
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: SYSTEM_INSTRUCTION }]
                },
                tools: TOOLS,
                inputAudioTranscription: {},
                outputAudioTranscription: {}
            }
        }

        console.log('[GeminiLive] Sending setup with tools:', TOOLS[0].functionDeclarations.map(t => t.name))
        this.ws.send(JSON.stringify(setupMsg))
    }

    /**
     * Handle incoming WebSocket messages (text or binary Blob)
     * @param {MessageEvent} event
     */
    _handleMessage(event) {
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
            console.log('[GeminiLive] Setup complete — tools registered')
            this.connected = true
            this.onSetupComplete()
            if (this._connectResolve) {
                this._connectResolve()
                this._connectResolve = null
            }
            return
        }

        // Tool call from model
        if (msg.toolCall) {
            const calls = msg.toolCall.functionCalls || []
            for (const call of calls) {
                console.log('[GeminiLive] Tool call received:', call.name, call.args)
                this.onToolCall({
                    id: call.id,
                    name: call.name,
                    args: call.args || {}
                })
            }
            return
        }

        // Server content
        if (msg.serverContent) {
            const sc = msg.serverContent

            if (sc.interrupted) {
                console.log('[GeminiLive] Interrupted by user')
                this.onInterrupted()
                return
            }

            if (sc.modelTurn && sc.modelTurn.parts) {
                for (const part of sc.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        this.onAudio(part.inlineData.data)
                    }
                }
            }

            if (sc.inputTranscription && sc.inputTranscription.text) {
                console.log('[GeminiLive] User said:', sc.inputTranscription.text)
            }

            if (sc.outputTranscription && sc.outputTranscription.text) {
                console.log('[GeminiLive] AI said:', sc.outputTranscription.text)
            }

            if (sc.turnComplete) {
                console.log('[GeminiLive] Turn complete')
                this.onTurnComplete()
            }
        }
    }

    /**
     * Send a tool response back to Gemini after executing a function call
     * @param {string} callId - The function call ID from the toolCall message
     * @param {string} functionName - Name of the function that was called
     * @param {object} result - The result to return to the model
     */
    sendToolResponse(callId, functionName, result) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const msg = {
            toolResponse: {
                functionResponses: [{
                    id: callId,
                    name: functionName,
                    response: {
                        output: result
                    }
                }]
            }
        }

        console.log('[GeminiLive] Sending tool response for', functionName, ':', result)
        this.ws.send(JSON.stringify(msg))
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
                turns: [{ role: 'user', parts: [{ text }] }],
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
