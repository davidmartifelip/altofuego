/**
 * Cloudflare Function: Token proxy for Gemini Live API
 * 
 * Generates OAuth2 access tokens using the Google Cloud Service Account JSON
 * stored in the SERVICE_ACCOUNT_JSON environment variable.
 */

export async function onRequest(context) {
    const { env } = context;
    const saJson = env.SERVICE_ACCOUNT_JSON;

    if (!saJson) {
        return new Response(JSON.stringify({ error: 'SERVICE_ACCOUNT_JSON not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const serviceAccount = JSON.parse(saJson);
        const tokenData = await getAccessToken(serviceAccount);

        return new Response(JSON.stringify({ accessToken: tokenData.accessToken }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function getAccessToken(serviceAccount) {
    const jwt = await createJWT(serviceAccount);

    const res = await fetch(serviceAccount.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    return {
        accessToken: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
}

async function createJWT(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language',
        aud: serviceAccount.token_uri,
        iat: now,
        exp: now + 3600,
    };

    const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const unsigned = `${b64(header)}.${b64(payload)}`;

    // Import the private key
    const pemContents = serviceAccount.private_key
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
        'pkcs8',
        binaryKey.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(unsigned)
    );

    const b64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return `${unsigned}.${b64Signature}`;
}
