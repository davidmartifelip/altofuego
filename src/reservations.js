/**
 * Reservations module — Gemini Tool Executor
 *
 * Called by main.js when Gemini fires a toolCall.
 * Sends the structured data to the Vite proxy, which forwards to n8n.
 * Returns the result for the toolResponse back to Gemini.
 */

/**
 * Execute consultar_disponibilidad
 * @param {{ fecha: string, hora: string, comensales: number }} args
 * @returns {Promise<object>} n8n response
 */
export async function executeConsultarDisponibilidad(args) {
    const payload = {
        fecha: args.fecha,        // YYYY-MM-DD
        hora: args.hora,          // HH:MM
        comensales: Number(args.comensales),
    }

    console.log('[Reservations] Checking availability:', payload)

    try {
        const res = await fetch('/api/webhook/disponibilidad', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })

        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            return {
                disponible: false,
                mensaje: err.error || 'Error al consultar disponibilidad. Inténtalo de nuevo.',
            }
        }

        const data = await res.json()
        console.log('[Reservations] Availability result:', data)
        return data

    } catch (err) {
        console.error('[Reservations] Availability fetch failed:', err)
        return {
            disponible: false,
            mensaje: 'No se pudo conectar con el sistema de reservas. Llámanos directamente.',
        }
    }
}

/**
 * Execute crear_reserva
 * @param {{ nombre: string, fecha: string, hora: string, comensales: number, telefono: string, zona: string, observaciones?: string }} args
 * @returns {Promise<object>} n8n response
 */
export async function executeCrearReserva(args) {
    const payload = {
        nombre: args.nombre,
        fecha: args.fecha,
        hora: args.hora,
        comensales: Number(args.comensales),
        telefono: args.telefono,
        zona: args.zona,
        ...(args.observaciones && { observaciones: args.observaciones }),
    }

    console.log('[Reservations] Creating reservation:', payload)

    try {
        const res = await fetch('/api/webhook/reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })

        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            return {
                exito: false,
                mensaje: err.error || 'No se pudo crear la reserva. Por favor, llama directamente al restaurante.',
            }
        }

        const data = await res.json()
        console.log('[Reservations] Reservation result:', data)
        return data

    } catch (err) {
        console.error('[Reservations] Reservation fetch failed:', err)
        return {
            exito: false,
            mensaje: 'No se pudo conectar con el sistema de reservas. Llámanos directamente.',
        }
    }
}
