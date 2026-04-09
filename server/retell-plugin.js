import { loadEnv } from 'vite'

export function retellPlugin() {
  return {
    name: 'vite-plugin-retell',
    configureServer(server) {
      server.middlewares.use('/api/make-call', async (req, res, next) => {
        if (req.method !== 'POST') {
          return next()
        }

        let body = ''
        req.on('data', chunk => {
          body += chunk.toString()
        })

        req.on('end', async () => {
          try {
            // Load environment variables using Vite's built-in loader
            const env = loadEnv(server.config.mode, process.cwd(), '')
            const apiKey = env.RETELL_API_KEY

            if (!apiKey) {
              console.error('[Retell Plugin] Error: falta RETELL_API_KEY a .env')
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'RETELL_API_KEY not configured in .env' }))
              return
            }

            const data = JSON.parse(body)
            const agentId = data.agent_id

            if (!agentId) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'agent_id is required' }))
              return
            }

            const response = await fetch('https://api.retellai.com/v2/create-web-call', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                agent_id: agentId
              })
            })

            if (!response.ok) {
              const errorText = await response.text()
              console.error('[Retell Plugin] API Error:', response.status, errorText)
              res.statusCode = response.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Retell API Error', details: errorText }))
              return
            }

            const responseData = await response.json()
            
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ access_token: responseData.access_token }))
          } catch (error) {
            console.error('[Retell Plugin] Webhook Error:', error)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Internal Server Error' }))
          }
        })
      })
    }
  }
}
