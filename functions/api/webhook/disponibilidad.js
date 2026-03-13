/**
 * Cloudflare Function: Webhook Proxy for Disponibilidad
 */

export async function onRequestPost(context) {
    const { env, request } = context;
    const targetUrl = env.N8N_WEBHOOK_DISPONIBILIDAD;

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: 'Webhook URL not configured' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const body = await request.json();

    try {
        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.text();
        return new Response(data, {
            status: res.status,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
