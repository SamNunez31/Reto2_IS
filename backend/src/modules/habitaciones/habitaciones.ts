import { Consulta } from '../../database/db.service';

/** Estados de una unidad física (habitación de hotel, casa, cabaña o departamento): libre → ocupada (check-in) → en preparación (check-out) → libre (la marca el dueño). */
export type EstadoHabitacion = 'DISPONIBLE' | 'OCUPADA' | 'EN_PREPARACION';

/** Los que el dueño puede fijar a mano; OCUPADA solo la pone el check-in. */
export const ESTADOS_EDITABLES: readonly EstadoHabitacion[] = ['DISPONIBLE', 'EN_PREPARACION'];

export interface HabitacionLibre {
  id: string;
  numero: string;
}

export type ResultadoAsignacion =
  | { tipo: 'NO_HOTEL' }
  | { tipo: 'ASIGNADA'; id: string; numero: string }
  | { tipo: 'SIN_DISPONIBLES' }
  | { tipo: 'NO_VALIDA' };

/** ¿El alojamiento es un hotel? Solo en hoteles el admin elige la habitación en el check-in; en los demás tipos se asigna sola. */
export async function esUnidadDeHotel(q: Consulta, unidadId: string): Promise<boolean> {
  const f = await q<{ es: boolean }>(
    `SELECT (t.nombre = 'Hotel') AS es
       FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id JOIN tipo_alojamiento t ON t.id = a.tipo_id
      WHERE u.id = $1::uuid`,
    [unidadId],
  );
  return f[0]?.es === true;
}

/** ¿Este tipo tiene unidades físicas registradas (habitacion)? Si no, el check-in sigue sin asignar ninguna. */
export async function unidadConHabitaciones(q: Consulta, unidadId: string): Promise<boolean> {
  const f = await q<{ n: number }>(`SELECT count(*)::int AS n FROM habitacion WHERE unidad_id = $1::uuid`, [unidadId]);
  return (f[0]?.n ?? 0) > 0;
}

/** Habitaciones libres de un tipo de habitación, en orden de número. */
export function habitacionesDisponibles(q: Consulta, unidadId: string): Promise<HabitacionLibre[]> {
  return q<HabitacionLibre>(
    `SELECT id::text AS id, numero FROM habitacion WHERE unidad_id = $1::uuid AND estado = 'DISPONIBLE' ORDER BY length(numero), numero`,
    [unidadId],
  );
}

/**
 * Check-in: deja OCUPADA la habitación elegida (o la primera libre si no se elige) y la vincula a la orden.
 * Debe llamarse dentro de la transacción del check-in. No lanza: informa el resultado.
 */
export async function asignarHabitacion(q: Consulta, reservaId: string, unidadId: string, habitacionId?: string): Promise<ResultadoAsignacion> {
  if (!(await unidadConHabitaciones(q, unidadId))) return { tipo: 'NO_HOTEL' };
  const tomada = habitacionId
    ? await q<HabitacionLibre>(
        `UPDATE habitacion SET estado = 'OCUPADA', actualizada_en = now()
          WHERE id = $1::uuid AND unidad_id = $2::uuid AND estado = 'DISPONIBLE' RETURNING id::text AS id, numero`,
        [habitacionId, unidadId],
      )
    : await q<HabitacionLibre>(
        `UPDATE habitacion SET estado = 'OCUPADA', actualizada_en = now()
          WHERE id = (SELECT id FROM habitacion WHERE unidad_id = $1::uuid AND estado = 'DISPONIBLE'
                       ORDER BY length(numero), numero LIMIT 1 FOR UPDATE SKIP LOCKED)
            AND estado = 'DISPONIBLE' RETURNING id::text AS id, numero`,
        [unidadId],
      );
  if (!tomada.length) return { tipo: habitacionId ? 'NO_VALIDA' : 'SIN_DISPONIBLES' };
  await q(`UPDATE orden_v2 SET habitacion_id = $2::uuid WHERE reserva_id = $1::uuid`, [reservaId, tomada[0].id]);
  return { tipo: 'ASIGNADA', id: tomada[0].id, numero: tomada[0].numero };
}

/** Check-out: la habitación de la estadía pasa a EN_PREPARACION. Devuelve su número, o null si la orden no tenía habitación real. */
export async function pasarAPreparacion(q: Consulta, reservaId: string): Promise<string | null> {
  const f = await q<{ numero: string }>(
    `UPDATE habitacion SET estado = 'EN_PREPARACION', actualizada_en = now()
      WHERE id = (SELECT habitacion_id FROM orden_v2 WHERE reserva_id = $1::uuid) RETURNING numero`,
    [reservaId],
  );
  return f[0]?.numero ?? null;
}

/** Texto que se guarda en orden_v2.habitacion_asignada: «Suite Familiar 109», «Cabaña Familiar 2». */
export const etiquetaHabitacion = (unidad: string, numero: string): string => `${unidad} ${numero}`.slice(0, 100);
