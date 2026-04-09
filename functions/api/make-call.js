export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json()
    const agentId = data.agent_id

    if (!agentId) {
      return new Response(JSON.stringify({ error: 'agent_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const apiKey = env.RETELL_API_KEY
    if (!apiKey) {
      console.error('[Retell] RETELL_API_KEY no configurat a l\'entorn')
      return new Response(JSON.stringify({ error: 'RETELL_API_KEY not configured' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const response = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ agent_id: agentId })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(JSON.stringify({ error: 'Retell API Error', details: errorText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const responseData = await response.json()
    
    return new Response(JSON.stringify({ access_token: responseData.access_token }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('[Retell] error in make-call:', err)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
