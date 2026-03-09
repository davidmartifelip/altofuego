/**
 * Vite plugin: n8n Webhook Proxy
 *
 * Exposes two server-side endpoints to forward requests to n8n:
 *   POST /api/webhook/disponibilidad  →  N8N_WEBHOOK_DISPONIBILIDAD
 *   POST /api/webhook/reserva         →  N8N_WEBHOOK_RESERVA
 *
 * The n8n URLs never reach the browser.
 */

export function webhooksPlugin() {
    return {
        name: 'n8n-webhooks-proxy',

        configureServer(server) {
            const DISPONIBILIDAD_URL = process.env.N8N_WEBHOOK_DISPONIBILIDAD
            const RESERVA_URL = process.env.N8N_WEBHOOK_RESERVA

            if (!DISPONIBILIDAD_URL || !RESERVA_URL) {
                console.warn('[WebhooksProxy] ⚠️  N8N webhook URLs not set in .env — reservations will fail')
            } else {
                console.log('[WebhooksProxy] ✅ n8n endpoints configured')
            }

            server.middlewares.use(async (req, res, next) => {
                // Only handle our two paths
                if (
                    req.method !== 'POST' ||
                    !req.url.startsWith('/api/webhook/')
                ) return next()

                const isDisponibilidad = req.url === '/api/webhook/disponibilidad'
                const isReserva = req.url === '/api/webhook/reserva'

                if (!isDisponibilidad && !isReserva) return next()

                const targetUrl = isDisponibilidad ? DISPONIBILIDAD_URL : RESERVA_URL

                if (!targetUrl) {
                    res.writeHead(503, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'n8n webhook URL not configured' }))
                    return
                }

                // Read body
                let body = ''
                for await (const chunk of req) body += chunk

                console.log(`[WebhooksProxy] → ${isDisponibilidad ? 'disponibilidad' : 'reserva'}:`, body)

                try {
                    const n8nRes = await fetch(targetUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body,
                    })

                    const responseText = await n8nRes.text()
                    console.log(`[WebhooksProxy] ← n8n responded ${n8nRes.status}:`, responseText)

                    res.writeHead(n8nRes.ok ? 200 : n8nRes.status, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store',
                    })
                    res.end(responseText)
                } catch (err) {
                    console.error('[WebhooksProxy] n8n request failed:', err.message)
                    res.writeHead(502, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({
                        error: 'No se pudo conectar con el sistema de reservas',
                        detail: err.message
                    }))
                }
            })
        },
    }
}
