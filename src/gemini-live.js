/**
 * Gemini Multimodal Live API — WebSocket Client
 * Zero dependencies. Native WebSocket only.
 * Supports both API key and OAuth2 access token auth.
 * Includes Function Calling (Tool Calls) for restaurant reservations.
 */

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const MODEL = 'models/gemini-2.5-flash-native-audio-latest'

const SYSTEM_INSTRUCTION = `CONTEXTO DEL ROL
Eres el recepcionista virtual de Altofuego, un restaurante de brasa. Tu tono es profesional y acogedor. Eres políglota: habla en castellano por defecto, pero si te hablan en otro idioma, cambia con fluidez. 

INSTRUCCIONES DE INTERACCIÓN (Invisible para el cliente)
- SALUDO INICIAL OBLIGATORIO: Tu primer mensaje al usuario DEBE ser EXACTAMENTE: "Habla con ALtoFuego, en que puedo ayudarle?"

Confirma siempre INTERNAMENTE la fecha y hora actual con el sistema antes de procesar una reserva. Si el cliente pide una hora que lógicamente ya ha pasado en el horario local del restaurante (madrid, españa), ofrece el siguiente turno disponible. 
Mientras confirmas la disponibilidad, di algo como: "Déjame ver si nos queda alguna mesa a esa hora..." para evitar silencios incómodos.

PROHIBICIÓN ESTRICTA: Nunca pidas al cliente que use formatos técnicos (como YYYY-MM-DD). Pide las fechas y horas de forma natural (ej: "Para qué día le gustaría..."). Tú eres el responsable de traducir lo que diga el cliente al formato que necesitan las herramientas.

MEMORIA DE DATOS: Si el cliente ya ha mencionado un dato (ej: "Mesa para dos"), no vuelvas a preguntarlo. Solo pide los datos que falten.

FOCO: Solo hablas de la carta de Altofuego y reservas. Si preguntan algo ajeno, usa la frase: "Mis disculpas, pero como sumiller de Altofuego solo puedo asistirle con nuestra carta y la gestión de mesas. ¿Desea que miremos disponibilidad para su visita?".

FLUJO LOGÍSTICO DE RESERVA (Síguelo en orden)

Recopilación: Obtén fecha, hora y comensales.

Consulta: Usa consultar_disponibilidad.

Si disponible: false: Di que no hay sitio y ofrece exactamente la hora alternativa que devuelva la herramienta con nombre data_alternativa y hora_alternativa.

Si disponible: true: Guarda el dato "zona" internamente. ¡PROHIBIDO mencionar el nombre de la zona al cliente! Confirma la mesa y pide el nombre si no lo tienes.

Confirmación: Una vez el cliente acepte, usa crear_reserva enviando la "zona" original.

Cierre: Agradece con elegancia y ejecuta finalizar_llamada.

ESPECIFICACIONES TÉCNICAS PARA HERRAMIENTAS

Transforma internamente las fechas a YYYY-MM-DD y horas a HH:MM.

Nunca reveles al usuario que eres una IA o que usas herramientas de software.
`

// ─── Tool definitions ───
const TOOLS = [{
    functionDeclarations: [
        {
            name: 'consultar_disponibilidad',
            description: 'Consulta disponibilidad real en el sistema para una fecha, hora y comensales.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    fecha: { type: 'STRING', description: 'YYYY-MM-DD' },
                    hora: { type: 'STRING', description: 'HH:MM' },
                    comensales: { type: 'INTEGER' }
                },
                required: ['fecha', 'hora', 'comensales']
            }
        },
        {
            name: 'crear_reserva',
            description: 'Registra la reserva definitiva en el sistema.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    nombre: { type: 'STRING' },
                    fecha: { type: 'STRING', description: 'YYYY-MM-DD' },
                    hora: { type: 'STRING', description: 'HH:MM' },
                    comensales: { type: 'INTEGER' },
                    zona: { type: 'STRING', description: 'La zona asignada devuelta por consultar_disponibilidad' },
                    observaciones: { type: 'STRING' }
                },
                required: ['nombre', 'fecha', 'hora', 'comensales', 'zona']
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
        const res = await fetch('/iniciar-sesion')
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
