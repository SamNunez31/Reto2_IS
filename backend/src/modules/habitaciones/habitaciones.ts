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

/**
 * Reserva una habitación concreta para unas fechas: elige la primera del tipo que no esté ya asignada a otra
 * estancia que se solape. No cambia el estado físico (la habitación sigue DISPONIBLE hasta que el huésped llega).
 */
export async function asignarHabitacionParaFechas(
  q: Consulta,
  reservaId: string,
  unidadId: string,
  entrada: string,
  salida: string,
): Promise<{ id: string; numero: string } | null> {
  const libres = await q<{ id: string; numero: string }>(
    `SELECT h.id::text AS id, h.numero FROM habitacion h
      WHERE h.unidad_id = $1::uuid
        AND NOT EXISTS (SELECT 1 FROM reserva r LEFT JOIN orden_v2 o ON o.reserva_id = r.id
                         WHERE COALESCE(o.habitacion_id, r.habitacion_id) = h.id AND r.estado <> 'CANCELADA'
                           AND r.fecha_entrada < $3::date AND r.fecha_salida > $2::date
                           -- Si ese huésped ya se fue antes de esta llegada, la habitación vuelve a estar libre
                           AND (COALESCE(o.checkout_en, r.checkout_en) IS NULL
                                OR (COALESCE(o.checkout_en, r.checkout_en) AT TIME ZONE 'America/Guayaquil')::date > $2::date))
      ORDER BY h.numero::integer LIMIT 1`,
    [unidadId, entrada, salida],
  );
  const h = libres[0];
  if (!h) return null;
  await q(`UPDATE orden_v2 SET habitacion_id = $2::uuid WHERE reserva_id = $1::uuid`, [reservaId, h.id]);
  return h;
}

/** Guarda la habitación en la orden de Booking o, si la reserva es directa (sin orden), en la propia reserva. */
async function vincularHabitacion(q: Consulta, reservaId: string, habitacionId: string): Promise<void> {
  await q(`UPDATE orden_v2 SET habitacion_id = $2::uuid WHERE reserva_id = $1::uuid`, [reservaId, habitacionId]);
  await q(`UPDATE reserva SET habitacion_id = $2::uuid WHERE id = $1::uuid AND NOT EXISTS (SELECT 1 FROM orden_v2 WHERE reserva_id = $1::uuid)`, [reservaId, habitacionId]);
}

/** Marca como OCUPADA la habitación ya asignada a la reserva (al llegar el huésped). */
export async function ocuparHabitacionAsignada(q: Consulta, reservaId: string): Promise<string | null> {
  const f = await q<{ numero: string }>(
    `UPDATE habitacion SET estado = 'OCUPADA', actualizada_en = now()
      WHERE id = COALESCE((SELECT habitacion_id FROM orden_v2 WHERE reserva_id = $1::uuid), (SELECT habitacion_id FROM reserva WHERE id = $1::uuid)) RETURNING numero`,
    [reservaId],
  );
  return f[0]?.numero ?? null;
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
  await vincularHabitacion(q, reservaId, tomada[0].id);
  return { tipo: 'ASIGNADA', id: tomada[0].id, numero: tomada[0].numero };
}

/** Check-out: la habitación de la estadía pasa a EN_PREPARACION. Devuelve su número, o null si la orden no tenía habitación real. */
export async function pasarAPreparacion(q: Consulta, reservaId: string): Promise<string | null> {
  const f = await q<{ numero: string }>(
    `UPDATE habitacion SET estado = 'EN_PREPARACION', actualizada_en = now()
      WHERE id = COALESCE((SELECT habitacion_id FROM orden_v2 WHERE reserva_id = $1::uuid), (SELECT habitacion_id FROM reserva WHERE id = $1::uuid)) RETURNING numero`,
    [reservaId],
  );
  return f[0]?.numero ?? null;
}

/** Texto que se guarda en orden_v2.habitacion_asignada: «Suite Familiar 109», «Cabaña Familiar 2». */
export const etiquetaHabitacion = (unidad: string, numero: string): string => `${unidad} ${numero}`.slice(0, 100);

/**
 * Cuántas unidades físicas tiene el alojamiento y cómo se llama.
 * Solo se numera cuando hay más de una: un hotel con tres tipos de una habitación cada uno sí (101, 102, 103),
 * y una casa de una sola unidad no, porque su propio nombre ya la identifica.
 */
export async function alojamientoDeUnidad(q: Consulta, unidadId: string): Promise<{ total: number; nombre: string; numerar: boolean }> {
  const f = await q<{ total: number; nombre: string }>(
    `SELECT (SELECT count(*) FROM habitacion h WHERE h.alojamiento_id = a.id)::int AS total, a.nombre
       FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id WHERE u.id = $1::uuid`,
    [unidadId],
  );
  const total = f[0]?.total ?? 0;
  return { total, nombre: f[0]?.nombre ?? '', numerar: total > 1 };
}

/** Etiqueta final: «Habitación Individual 101» cuando hay varias; el nombre del alojamiento («Casa Colón») si es única. */
export async function etiquetaDeUnidad(q: Consulta, unidadId: string, unidad: string, numero: string | null): Promise<string> {
  const a = await alojamientoDeUnidad(q, unidadId);
  if (numero === null || !a.numerar) return (a.nombre || unidad).slice(0, 100);
  return etiquetaHabitacion(unidad, numero);
}

/** Habitaciones del mismo tipo libres esas fechas y listas para entrar (para el cambio excepcional en recepción). */
export async function habitacionesLibresParaFechas(
  q: Consulta,
  unidadId: string,
  entrada: string,
  salida: string,
  excluirId?: string,
): Promise<HabitacionLibre[]> {
  return q<HabitacionLibre>(
    `SELECT h.id::text AS id, h.numero FROM habitacion h
      WHERE h.unidad_id = $1::uuid AND h.estado = 'DISPONIBLE' AND ($4::uuid IS NULL OR h.id <> $4::uuid)
        AND NOT EXISTS (SELECT 1 FROM reserva r LEFT JOIN orden_v2 o ON o.reserva_id = r.id
                         WHERE COALESCE(o.habitacion_id, r.habitacion_id) = h.id AND r.estado <> 'CANCELADA'
                           AND r.fecha_entrada < $3::date AND r.fecha_salida > $2::date
                           AND (COALESCE(o.checkout_en, r.checkout_en) IS NULL
                                OR (COALESCE(o.checkout_en, r.checkout_en) AT TIME ZONE 'America/Guayaquil')::date > $2::date))
      ORDER BY h.numero::integer`,
    [unidadId, entrada, salida, excluirId ?? null],
  );
}

/**
 * Cambio excepcional en recepción: pasa la reserva a otra habitación del mismo tipo y la deja OCUPADA.
 * Devuelve el número si el cambio fue posible; null si esa habitación ya no sirve.
 */
export async function cambiarHabitacion(q: Consulta, reservaId: string, unidadId: string, habitacionId: string): Promise<string | null> {
  const f = await q<{ numero: string }>(
    `UPDATE habitacion SET estado = 'OCUPADA', actualizada_en = now()
      WHERE id = $1::uuid AND unidad_id = $2::uuid AND estado = 'DISPONIBLE' RETURNING numero`,
    [habitacionId, unidadId],
  );
  if (!f[0]) return null;
  // La que tenía reservada vuelve a quedar libre
  await q(
    `UPDATE habitacion SET estado = 'DISPONIBLE', actualizada_en = now()
      WHERE id = COALESCE((SELECT habitacion_id FROM orden_v2 WHERE reserva_id = $1::uuid), (SELECT habitacion_id FROM reserva WHERE id = $1::uuid)) AND id <> $2::uuid AND estado <> 'EN_PREPARACION'`,
    [reservaId, habitacionId],
  );
  await vincularHabitacion(q, reservaId, habitacionId);
  return f[0].numero;
}
