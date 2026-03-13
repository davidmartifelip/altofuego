# Guia de Desplegament: Altofuego en Cloudflare Pages

He preparat el projecte perquè sigui compatible amb Cloudflare. Aquí tens els passos detallats que has de seguir:

## 1. Preparar el codi a GitHub
1. Crea un repositori nou a **GitHub** (preferiblement privat).
2. Puja el codi del teu projecte.
    *   **IMPORTANT**: Assegura't que el fitxer `.env` i el fitxer `.json` del compte de servei **NO** es pugin (haurien d'estar al teu `.gitignore`).

## 2. Crear el projecte a Cloudflare
1. Entra al teu dashboard de **Cloudflare**.
2. Ves a **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
3. Selecciona el teu repositori.
4. En els **Build settings**:
    *   **Framework preset**: Selecciona `Vite`.
    *   **Build command**: `npm run build`
    *   **Build output directory**: `dist`

## 3. Configurar les Variables d'Entorn (CRÍTIC)
Abans de desplegar (o un cop creat el projecte, a la pestanya **Settings** -> **Environment variables**), has d'afegir les següents variables a la secció **Production**:

| Variable | Valor |
| :--- | :--- |
| `SERVICE_ACCOUNT_JSON` | Obre el teu fitxer `.json` de Google Cloud, copia **TOT** el text i enganxa'l aquí. |
| `N8N_WEBHOOK_DISPONIBILIDAD` | La URL del teu webhook de n8n per consultar disponibilitat. |
| `N8N_WEBHOOK_RESERVA` | La URL del teu webhook de n8n per crear la reserva. |

## 4. Configuracions Addicionals
Dins de la configuració del projecte a Cloudflare Pages:
1. Ves a **Settings** -> **Functions**.
2. A la secció **Compatibility flags**, comprova que el **Compatibility date** sigui recent. No cal activar el flag de Node.js perquè he programat les funcions amb codi estàndard de Web APIs (més ràpid i segur).

## 5. Verificar
Un cop es faci el "Build", la teva web estarà activa. Pots provar que tot funciona correctament:
*   La web carregarà des del teu domini de `.pages.dev`.
*   El botó de l'asistente de veu demanarà el token a `/api/token`, que ara és una **Cloudflare Function**.
*   Les reserves es comunicaran amb n8n a través del proxy segur.

---
> El plugin de Vite seguirà funcionant a local com sempre per fer proves. Cloudflare només farà servir els fitxers de la carpeta `/functions` que he creat.
