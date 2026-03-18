/**
 * Vite plugin: Token proxy for Gemini Live API
 * 
 * Reads the Google Cloud service account JSON,
 * generates OAuth2 access tokens via JWT,
 * and serves them at GET /api/token.
 * 
 * This runs server-side only — credentials never reach the browser.
 */

import { readFileSync } from 'fs'
import { createSign } from 'crypto'
import { resolve, join } from 'path'
import { readdirSync } from 'fs'

// Find the service account JSON file in the project root
function findServiceAccountFile(root) {
    const files = readdirSync(root)
    const saFile = files.find(
        (f) => f.endsWith('.json') && f !== 'package.json' && f !== 'package-lock.json' && f !== 'tsconfig.json'
    )
    if (!saFile) throw new Error('No service account JSON found in project root')
    return join(root, saFile)
}

// Create a signed JWT for Google OAuth2
function createJWT(serviceAccount) {
    const now = Math.floor(Date.now() / 1000)

    const header = {
        alg: 'RS256',
        typ: 'JWT',
    }

    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language',
        aud: serviceAccount.token_uri,
        iat: now,
        exp: now + 3600,
    }

    const b64 = (obj) =>
        Buffer.from(JSON.stringify(obj)).toString('base64url')

    const unsigned = `${b64(header)}.${b64(payload)}`

    const sign = createSign('RSA-SHA256')
    sign.update(unsigned)
    const signature = sign.sign(serviceAccount.private_key, 'base64url')

    return `${unsigned}.${signature}`
}

// Exchange JWT for an OAuth2 access token
async function getAccessToken(serviceAccount) {
    const jwt = createJWT(serviceAccount)

    const res = await fetch(serviceAccount.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    })

    if (!res.ok) {
        const body = await res.text()
        throw new Error(`Token exchange failed: ${res.status} ${body}`)
    }

    const data = await res.json()
    return {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 1min buffer
    }
}

export function geminiTokenPlugin() {
    let serviceAccount = null
    let cachedToken = null

    return {
        name: 'gemini-token-proxy',

        configureServer(server) {
            // Load service account on server start
            const saPath = findServiceAccountFile(server.config.root)
            serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'))
            console.log(`[TokenProxy] Loaded service account: ${serviceAccount.client_email}`)

            // Register middleware
            server.middlewares.use(async (req, res, next) => {
                if (req.url !== '/iniciar-sesion') return next()

                try {
                    // Return cached token if still valid
                    if (cachedToken && Date.now() < cachedToken.expiresAt) {
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-store',
                        })
                        res.end(JSON.stringify({ accessToken: cachedToken.accessToken }))
                        return
                    }

                    // Generate new token
                    console.log('[TokenProxy] Generating new access token...')
                    cachedToken = await getAccessToken(serviceAccount)
                    console.log('[TokenProxy] Token generated successfully')

                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store',
                    })
                    res.end(JSON.stringify({ accessToken: cachedToken.accessToken }))
                } catch (err) {
                    console.error('[TokenProxy] Error:', err.message)
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: err.message }))
                }
            })
        },
    }
}
