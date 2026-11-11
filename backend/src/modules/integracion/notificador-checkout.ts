import { Injectable } from '@nestjs/common';
import { logJson } from '../../common/logging/log-json';
import { DbService } from '../../database/db.service';
import { MAX_INTENTOS } from './notificador-checkin';

const PLAZO_MS = 8000;

/**
 * Ruta del check-out en Booking (CHECKOUT_REST_PATH, con {id}). No tiene valor por defecto: Booking no ha publicado
 * esa ruta, así que mientras la variable no exista el aviso queda pendiente (sin gastar intentos) y el check-out
 * sigue valiendo en Posada EC. Ejemplo, por analogía con el check-in: /api/v1/reservas/{id}/checkout
 */
export function rutaCheckout(externalOrderId: string): string | null {
  const plantilla = (process.env.CHECKOUT_REST_PATH ?? '').trim();
  return plantilla ? plantilla.replace('{id}', encodeURIComponent(externalOrderId)) : null;
}

/**
 * Avisa a Booking que el huésped salió del hotel:
 *   POST {BOOKING}{CHECKOUT_REST_PATH}   (X-API-Key)   cuerpo: { external_order_id, estado: 'CHECKED_OUT', fecha_checkout }
 * Misma mecánica que el check-in: idempotente (checkout_notificado_en), con reintentos y espera creciente;
 * un 4xx (salvo 408/429) no se reintenta.
 */
@Injectable()
export class NotificadorCheckout {
  constructor(private readonly db: DbService) {}

  private config(): { base: string; llave: string } | null {
    const base = (process.env.CHECKIN_REST_URL || process.env.STOCK_REST_URL || '').trim().replace(/\/$/, '');
    const llave = (process.env.CHECKIN_REST_API_KEY || process.env.STOCK_REST_API_KEY || '').trim();
    return base && llave ? { base, llave } : null;
  }

  /** Intenta avisar a Booking. true si Booking confirmó (2xx) o ya estaba notificado. Nunca lanza. */
  async notificar(reservaId: string): Promise<boolean> {
    try {
      const cfg = this.config();
      if (!cfg || !rutaCheckout('x')) {
        logJson('warn', 'checkout_notif_sin_config', { motivo: 'faltan STOCK_REST_URL/STOCK_REST_API_KEY o CHECKOUT_REST_PATH' });
        return false;
      }
      const reclamo = await this.db.query<{ intentos: number }>(
        `UPDATE orden_v2 SET checkout_notif_intentos = checkout_notif_intentos + 1, checkout_notif_ultimo = now()
          WHERE reserva_id = $1::uuid AND checkout_recepcion AND checkout_notificado_en IS NULL AND checkout_notif_intentos < $2
        RETURNING checkout_notif_intentos AS intentos`,
        [reservaId, MAX_INTENTOS],
      );
      if (!reclamo.length) {
        const ya = await this.db.uno<{ n: boolean }>(`SELECT (checkout_notificado_en IS NOT NULL) AS n FROM orden_v2 WHERE reserva_id = $1::uuid`, [reservaId]);
        return ya?.n === true;
      }
      const f = await this.db.uno<{ external: string; fecha: string }>(
        `SELECT r.codigo AS external, to_char(o.checkout_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha
           FROM orden_v2 o JOIN reserva r ON r.id = o.reserva_id WHERE o.reserva_id = $1::uuid`,
        [reservaId],
      );
      if (!f) return false;
      const externalOrderId = `ORD-HTL-${f.external.slice(3)}`;
      const ruta = rutaCheckout(externalOrderId) as string;
      let estado = 0;
      let detalle = '';
      try {
        const r = await fetch(`${cfg.base}${ruta}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.llave, 'x-correlation-id': `checkout-${reservaId.slice(0, 8)}-${reclamo[0].intentos}` },
          body: JSON.stringify({ external_order_id: externalOrderId, estado: 'CHECKED_OUT', fecha_checkout: f.fecha }),
          signal: AbortSignal.timeout(PLAZO_MS),
        });
        estado = r.status;
        if (!r.ok) detalle = (await r.text().catch(() => '')).slice(0, 200);
      } catch (e) {
        detalle = e instanceof Error ? e.message : String(e);
      }
      if (estado >= 200 && estado < 300) {
        await this.db.query(`UPDATE orden_v2 SET checkout_notificado_en = now(), checkout_notif_error = NULL WHERE reserva_id = $1::uuid`, [reservaId]);
        logJson('info', 'checkout_notificado_a_booking', { external_order_id: externalOrderId, status: estado, intentos: reclamo[0].intentos });
        return true;
      }
      const definitivo = estado >= 400 && estado < 500 && estado !== 408 && estado !== 429;
      await this.db.query(
        `UPDATE orden_v2 SET checkout_notif_error = $2, checkout_notif_intentos = CASE WHEN $3::boolean THEN $4 ELSE checkout_notif_intentos END WHERE reserva_id = $1::uuid`,
        [reservaId, `HTTP ${estado || 'sin respuesta'} ${detalle}`.slice(0, 300), definitivo, MAX_INTENTOS],
      );
      logJson(definitivo ? 'error' : 'warn', 'checkout_notif_fallo', { external_order_id: externalOrderId, status: estado, definitivo, detalle });
      return false;
    } catch (e) {
      logJson('error', 'checkout_notif_error', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  /** Reintenta los avisos pendientes (espera creciente: 20 s × 2^intentos, tope 64×). Sin ruta configurada no hace nada. */
  async reintentarPendientes(limite = 20): Promise<number> {
    if (!rutaCheckout('x')) return 0;
    const ids = await this.db.query<{ id: string }>(
      `SELECT reserva_id::text AS id FROM orden_v2
        WHERE checkout_recepcion AND checkout_notificado_en IS NULL AND checkout_notif_intentos < $1
          AND (checkout_notif_ultimo IS NULL OR checkout_notif_ultimo < now() - (interval '20 seconds' * power(2, least(checkout_notif_intentos, 6))))
        ORDER BY checkout_en LIMIT $2`,
      [MAX_INTENTOS, limite],
    );
    let enviados = 0;
    for (const { id } of ids) if (await this.notificar(id)) enviados++;
    return enviados;
  }
}
