import { Injectable } from '@nestjs/common';
import { UsuarioToken } from '../../common/auth/decorators';
import { Listado } from '../../common/http/respuestas';
import { conflicto, invalido, noEncontrado } from '../../common/problem/problem';
import { Consulta, DbService } from '../../database/db.service';
import { aCentavos, aMoney, RE_MONEY } from '../alojamientos-v2/util-v2';
import { sqlPago } from '../alojamientos/services/ordenes.service';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { NotificadorCheckout } from '../integracion/notificador-checkout';
import {
  alojamientoDeUnidad, asignarHabitacion, cambiarHabitacion, ESTADOS_EDITABLES, esUnidadDeHotel, EstadoHabitacion, etiquetaDeUnidad,
  habitacionesLibresParaFechas, ocuparHabitacionAsignada, pasarAPreparacion,
} from '../habitaciones/habitaciones';
import {
  ActualizarAlojamientoDto, ActualizarUnidadDto, CalendarioDto, CrearAlojamientoDto, FiltroReservasHostDto, UnidadDto,
} from './dto/host.dto';

/** Columnas de alojamiento que el anfitrión puede escribir (lista blanca para el UPDATE dinámico). */
const COLUMNAS_ALOJ = [
  'tipo_id', 'ciudad_id', 'politica_id', 'nombre', 'descripcion', 'direccion', 'latitud', 'longitud', 'telefono_contacto',
  'hora_checkin', 'hora_checkout', 'noches_min', 'noches_max', 'tarifa_limpieza', 'modo_reserva', 'reglas_casa',
  'categoria_estrellas',
] as const;
/**
 * Una fila por reserva para el panel del ADMIN (incluye método y estado del pago).
 * El total de una reserva de Booking es el de su orden (incluye tasa municipal); v_reserva_total no la suma.
 */
const SQL_RESERVA_HOST = `
  SELECT r.id, r.codigo, r.estado::text AS estado, a.nombre AS alojamiento, a.codigo AS alojamiento_codigo, a.anfitrion_id,
         u.nombres || ' ' || u.apellidos AS huesped, r.fecha_entrada, r.fecha_salida, r.num_huespedes,
         COALESCE(o.total, t.total) AS total, r.created_at, ${sqlPago('r.id')}, (o.reserva_id IS NOT NULL) AS canal_booking, COALESCE(o.checkin_en, r.checkin_en) AS checkin_en,
         o.titular->>'nombreCompleto' AS titular_nombre, o.titular->>'tipoDocumento' AS titular_tipo_documento,
         o.titular->>'identificacion' AS titular_identificacion, COALESCE(o.habitacion_asignada, r.habitacion_asignada) AS habitacion_asignada,
         COALESCE(o.checkout_en, r.checkout_en) AS checkout_en,
         a.hora_checkout::text AS hora_checkout,
         COALESCE(o.motivo_cancelacion, cn.motivo) AS motivo_cancelacion,
         COALESCE(o.solicitado_por, CASE WHEN cn.reserva_id IS NULL THEN NULL
                                         WHEN cn.cancelada_por = r.huesped_id THEN 'CLIENTE' ELSE 'HOTEL' END) AS cancelada_por,
         COALESCE(o.cancelada_en, cn.cancelada_en) AS cancelada_en
    FROM reserva r
    LEFT JOIN orden_v2 o ON o.reserva_id = r.id
    LEFT JOIN cancelacion cn ON cn.reserva_id = r.id
    JOIN alojamiento a ON a.id = r.alojamiento_id
    JOIN usuario u ON u.id = r.huesped_id
    JOIN v_reserva_total t ON t.reserva_id = r.id`;

const COLUMNAS_UNIDAD = ['nombre', 'capacidad_huespedes', 'num_habitaciones', 'num_camas', 'num_banos', 'cantidad', 'precio_noche_base', 'activa'] as const;

export interface ResumenAlojamiento {
  codigo: number;
  nombre: string;
  tipo: string;
  ciudad: string;
  provincia: string;
  estado: string;
  modo_reserva: string;
  precio_desde: number | null;
  portada: string | null;
  calificacion: number | null;
  num_resenas: number;
  unidades_activas: number;
}

export interface UnidadHost {
  id: string;
  nombre: string;
  capacidad_huespedes: number;
  num_habitaciones: number;
  num_camas: number;
  num_banos: number;
  cantidad: number;
  precio_noche_base: number;
  activa: boolean;
}

export interface ReservaHost {
  id: string;
  codigo: string;
  estado: string;
  alojamiento: string;
  alojamiento_codigo: number;
  huesped: string;
  fecha_entrada: string;
  fecha_salida: string;
  num_huespedes: number;
  total: number;
  created_at: string;
  /** TARJETA | EFECTIVO */
  metodo_pago: string | null;
  /** PENDIENTE (efectivo aún no recibido) | APROBADO */
  estado_pago: string | null;
  /** true si la reserva llegó por el canal Booking (orden v2). Las directas también admiten check-in y check-out, sin aviso a Booking */
  canal_booking: boolean;
  /** Momento en que el huésped llegó (null si aún no) */
  checkin_en: string | null;
  /** Titular real de la reserva de Booking (null en reservas del canal propio) */
  titular_nombre: string | null;
  titular_tipo_documento: string | null;
  titular_identificacion: string | null;
  /** Habitación del hotel asignada en el check-in (p. ej. «Suite Familiar 109»); null en otros tipos o antes de llegar */
  habitacion_asignada: string | null;
  /** Momento de salida del huésped; null si aún no salió */
  checkout_en: string | null;
  /** Hora de salida del alojamiento (HH:MM:SS) */
  hora_checkout: string;
  /** Motivo de la cancelación, tal como lo envió quien canceló (null si no está cancelada) */
  motivo_cancelacion: string | null;
  /** Quién canceló: CLIENTE, HOTEL, ADMIN o SAGA_ORCHESTRATOR */
  cancelada_por: string | null;
  cancelada_en: string | null;
}

export interface RespuestaLlegada {
  reserva: ReservaHost;
  estado: 'CHECKED_IN';
  habitacion_asignada: string;
  /** Huéspedes que llegaron de más respecto a los reservados (0 si coinciden) */
  huespedes_extra: number;
  /** Capacidad máxima de la unidad reservada: no se admite a más personas que esta cifra */
  aforo_maximo: number;
  ya_registrado: boolean;
  /** true si Booking confirmó el aviso; false = queda en cola de reintentos automáticos */
  booking_notificado: boolean;
}

export interface DatosLlegada {
  observaciones?: string;
  huespedes_reales?: number;
  admin_id?: string;
  habitacion?: string;
  /** Solo para el cambio excepcional en recepción: otra habitación libre del mismo tipo */
  habitacion_id?: string;
  /** Obligatorio si se cambia de habitación: por qué no se entrega la asignada */
  motivo_cambio?: string;
}

export interface DatosSalida {
  observaciones?: unknown;
  /** Consumos extra a cobrar en recepción (minibar, restaurante…) */
  consumos?: unknown;
  /** Cómo se cobran: EFECTIVO o CARGO_A_RESERVA (tarjeta registrada) */
  metodo_pago_consumos?: unknown;
}

const METODOS_CONSUMO = ['EFECTIVO', 'CARGO_A_RESERVA'] as const;

/** Valida los consumos extra del check-out; devuelve las líneas y el total en centavos. */
export function leerConsumos(d: DatosSalida): { lineas: { item: string; cantidad: number; precio: string }[]; centavos: number; metodo: string } {
  const campos: { name: string; reason: string }[] = [];
  const lineas: { item: string; cantidad: number; precio: string }[] = [];
  let centavos = 0;
  if (d.consumos !== undefined) {
    if (!Array.isArray(d.consumos) || d.consumos.length > 50) campos.push({ name: 'consumos', reason: 'lista de hasta 50 consumos' });
    else {
      d.consumos.forEach((c: unknown, i: number) => {
        const x = (c ?? {}) as Record<string, unknown>;
        const cantidad = x.cantidad === undefined ? 1 : x.cantidad;
        if (typeof x.item !== 'string' || !x.item.trim() || x.item.length > 80) campos.push({ name: `consumos[${i}].item`, reason: 'texto de 1 a 80 caracteres' });
        else if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) campos.push({ name: `consumos[${i}].cantidad`, reason: 'entero entre 1 y 100' });
        else if (typeof x.precio !== 'string' || !RE_MONEY.test(x.precio)) campos.push({ name: `consumos[${i}].precio`, reason: 'importe como "3.50"' });
        else {
          centavos += cantidad * aCentavos(x.precio);
          lineas.push({ item: x.item.trim(), cantidad, precio: x.precio });
        }
      });
    }
  }
  const metodo = d.metodo_pago_consumos === undefined ? 'EFECTIVO' : String(d.metodo_pago_consumos);
  if (!(METODOS_CONSUMO as readonly string[]).includes(metodo)) campos.push({ name: 'metodo_pago_consumos', reason: 'EFECTIVO o CARGO_A_RESERVA' });
  if (campos.length) throw invalido('Datos de salida no válidos', campos);
  return { lineas, centavos, metodo };
}

export interface FilaIngresos {
  mes: string;
  estancias: number;
  /** Lo que queda para el alojamiento: hospedaje + servicio + limpieza (sin impuestos) */
  ingreso_sin_iva: number;
  /** IVA y tasa municipal, que se entregan al Estado */
  impuestos: number;
  /** Lo cobrado al huésped */
  ingreso_bruto: number;
}

export interface SugerenciaHabitacion {
  codigo_tipo: string;
  nombre: string;
  capacidad: number;
  precio_noche: number;
  libres: number;
}

export interface DatosCheckinHost {
  es_hotel: boolean;
  /** El alojamiento tiene más de una unidad física: solo entonces se muestra el número */
  numerada: boolean;
  /** Otras habitaciones libres del mismo tipo, para el cambio excepcional en recepción */
  habitaciones_libres: { id: string; numero: string }[];
  /** Habitación fijada al crear la reserva (p. ej. «Habitación Individual 101») */
  habitacion_asignada: string | null;
  alojamiento_codigo: number;
  /** Otros tipos libres esas fechas, por si llegaron más huéspedes de los reservados */
  sugerencias: SugerenciaHabitacion[];
}

export interface RespuestaSalida {
  reserva: ReservaHost;
  estado: 'CHECKED_OUT';
  /** Número de la habitación que quedó EN_PREPARACION; null si la estadía no tenía habitación real (no es hotel) */
  habitacion_en_preparacion: string | null;
  /** Consumos extra cobrados en la salida (minibar, etc.), importe "0.00" si no hubo */
  consumos_total: string;
  ya_registrado: boolean;
  booking_notificado: boolean;
}

export interface HabitacionHost {
  id: string;
  numero: string;
  estado: EstadoHabitacion;
  actualizada_en: string;
  alojamiento_codigo: number;
  alojamiento: string;
  unidad: string;
  /** Reserva que la ocupa ahora (si está OCUPADA) */
  reserva_codigo: string | null;
  /** Próxima llegada con esta habitación ya asignada (aún sin check-in) */
  proxima_codigo: string | null;
  proxima_entrada: string | null;
  proxima_salida: string | null;
  proxima_huesped: string | null;
}

/**
 * Posada EC administra su catálogo: el controlador solo admite ADMIN, que opera sobre cualquier alojamiento
 * (excepción de ADMIN en las comprobaciones de propiedad). Si en el futuro vuelve el portal de anfitriones,
 * un USUARIO solo vería lo suyo y lo ajeno respondería 404 (no se revela que existe).
 * Todo alojamiento nuevo queda a nombre de quien lo crea (el admin) y con reserva inmediata.
 */
@Injectable()
export class HostService {
  constructor(private readonly db: DbService, private readonly checkin: NotificadorCheckin, private readonly checkout: NotificadorCheckout) {}

  /** La conexión como `Consulta`, para los ayudantes de habitaciones. */
  private readonly consulta: Consulta = <T>(sql: string, params?: unknown[]) => this.db.query<T>(sql, params);

  /** null = sin filtro de dueño (ADMIN); si no, el id del usuario. */
  private dueno(user: UsuarioToken): string | null {
    return user.rol === 'ADMIN' ? null : user.sub;
  }

  async misAlojamientos(user: UsuarioToken): Promise<ResumenAlojamiento[]> {
    return this.db.query<ResumenAlojamiento>(
      `SELECT a.codigo, r.nombre, r.tipo, r.ciudad, r.provincia::text AS provincia, r.estado::text AS estado,
              r.modo_reserva::text AS modo_reserva, r.precio_desde, r.portada, r.calificacion, r.num_resenas::int AS num_resenas,
              (SELECT count(*)::int FROM unidad_alojamiento u WHERE u.alojamiento_id = a.id AND u.activa) AS unidades_activas
         FROM alojamiento a
         JOIN v_alojamiento_resumen r ON r.id = a.id
        WHERE ($1::uuid IS NULL OR a.anfitrion_id = $1) ORDER BY a.created_at DESC`,
      [this.dueno(user)],
    );
  }

  /** Crea el alojamiento en BORRADOR (con amenidades e imágenes) en una sola transacción. */
  async crear(dto: CrearAlojamientoDto, user: UsuarioToken): Promise<{ codigo: number }> {
    this.validarNoches(dto.noches_min, dto.noches_max);
    return this.db.transaccion(async (q) => {
      const cols = COLUMNAS_ALOJ.filter((c) => dto[c] !== undefined);
      const valores = cols.map((c) => dto[c]);
      const [{ id }] = await q<{ id: string }>(
        `INSERT INTO alojamiento (anfitrion_id, ${cols.join(', ')})
         VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
        [user.sub, ...valores],
      );
      await this.reemplazarHijos(q, id, dto);
      const [{ codigo }] = await q<{ codigo: number }>(`SELECT codigo FROM alojamiento WHERE id = $1`, [id]);
      return { codigo };
    });
  }

  async obtener(codigo: number, user: UsuarioToken): Promise<Record<string, unknown>> {
    const id = await this.idPropio(codigo, user);
    const aloj = await this.db.uno<Record<string, unknown>>(
      `SELECT a.codigo, a.tipo_id, a.ciudad_id, a.politica_id, a.nombre, a.descripcion, a.direccion, a.latitud, a.longitud,
              a.telefono_contacto, to_char(a.hora_checkin, 'HH24:MI') AS hora_checkin, to_char(a.hora_checkout, 'HH24:MI') AS hora_checkout,
              a.noches_min, a.noches_max, a.tarifa_limpieza, a.modo_reserva::text AS modo_reserva, a.reglas_casa,
              a.categoria_estrellas, a.estado::text AS estado,
              COALESCE((SELECT array_agg(amenidad_id ORDER BY amenidad_id) FROM alojamiento_amenidad WHERE alojamiento_id = a.id), '{}') AS amenidades,
              COALESCE((SELECT json_agg(json_build_object('url', url, 'es_portada', es_portada) ORDER BY orden)
                          FROM imagen_alojamiento WHERE alojamiento_id = a.id), '[]') AS imagenes
         FROM alojamiento a WHERE a.id = $1`,
      [id],
    );
    return { ...aloj, unidades: await this.unidades(codigo, user) };
  }

  async actualizar(codigo: number, dto: ActualizarAlojamientoDto, user: UsuarioToken): Promise<Record<string, unknown>> {
    const id = await this.idPropio(codigo, user);
    this.validarNoches(dto.noches_min, dto.noches_max);
    await this.db.transaccion(async (q) => {
      const cols = COLUMNAS_ALOJ.filter((c) => dto[c] !== undefined);
      if (cols.length) {
        await q(`UPDATE alojamiento SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => dto[c])]);
      }
      await this.reemplazarHijos(q, id, dto);
    });
    return this.obtener(codigo, user);
  }

  /** BORRADOR <-> PUBLICADO. Un SUSPENDIDO solo lo reactiva el ADMIN. Publicar exige unidad activa y foto. */
  async cambiarPublicacion(codigo: number, publicar: boolean, user: UsuarioToken): Promise<{ estado: string }> {
    const id = await this.idPropio(codigo, user);
    const a = await this.db.uno<{ estado: string; unidades: number; fotos: number }>(
      `SELECT a.estado::text AS estado,
              (SELECT count(*)::int FROM unidad_alojamiento WHERE alojamiento_id = a.id AND activa) AS unidades,
              (SELECT count(*)::int FROM imagen_alojamiento WHERE alojamiento_id = a.id) AS fotos
         FROM alojamiento a WHERE a.id = $1`,
      [id],
    );
    if (a?.estado === 'SUSPENDIDO') throw conflicto('El alojamiento está suspendido por la administración');
    if (publicar && (!a?.unidades || !a?.fotos)) {
      throw invalido('Para publicar necesitas al menos una unidad activa y una foto', [
        { name: 'unidades', reason: `${a?.unidades ?? 0} activas` },
        { name: 'imagenes', reason: `${a?.fotos ?? 0} fotos` },
      ]);
    }
    const estado = publicar ? 'PUBLICADO' : 'BORRADOR';
    await this.db.query(`UPDATE alojamiento SET estado = $2 WHERE id = $1`, [id, estado]);
    return { estado };
  }

  async unidades(codigo: number, user: UsuarioToken): Promise<UnidadHost[]> {
    const id = await this.idPropio(codigo, user);
    return this.db.query<UnidadHost>(
      `SELECT id, nombre, capacidad_huespedes, num_habitaciones, num_camas, num_banos, cantidad, precio_noche_base, activa
         FROM unidad_alojamiento WHERE alojamiento_id = $1 ORDER BY precio_noche_base`,
      [id],
    );
  }

  async crearUnidad(codigo: number, dto: UnidadDto, user: UsuarioToken): Promise<UnidadHost> {
    const id = await this.idPropio(codigo, user);
    const cols = COLUMNAS_UNIDAD.filter((c) => dto[c] !== undefined);
    const fila = await this.db.uno<UnidadHost>(
      `INSERT INTO unidad_alojamiento (alojamiento_id, ${cols.join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       RETURNING id, nombre, capacidad_huespedes, num_habitaciones, num_camas, num_banos, cantidad, precio_noche_base, activa`,
      [id, ...cols.map((c) => dto[c])],
    );
    return fila as UnidadHost;
  }

  async actualizarUnidad(unidadId: string, dto: ActualizarUnidadDto, user: UsuarioToken): Promise<UnidadHost> {
    await this.unidadPropia(unidadId, user);
    const cols = COLUMNAS_UNIDAD.filter((c) => dto[c] !== undefined);
    if (!cols.length) throw invalido('Nada que actualizar');
    const fila = await this.db.uno<UnidadHost>(
      `UPDATE unidad_alojamiento SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1
       RETURNING id, nombre, capacidad_huespedes, num_habitaciones, num_camas, num_banos, cantidad, precio_noche_base, activa`,
      [unidadId, ...cols.map((c) => dto[c])],
    );
    return fila as UnidadHost;
  }

  /** Calendario: excepciones de precio/cupo y cupo libre calculado por la BD (fn_cupo_unidad) día a día. */
  async calendario(unidadId: string, desde: string, hasta: string, user: UsuarioToken): Promise<Record<string, unknown>[]> {
    await this.unidadPropia(unidadId, user);
    if (hasta < desde) throw invalido('Rango inválido', [{ name: 'hasta', reason: 'debe ser >= desde' }]);
    return this.db.query<Record<string, unknown>>(
      `SELECT d::date::text AS fecha, c.precio_noche, c.cantidad_a_la_venta,
              COALESCE(c.precio_noche, u.precio_noche_base) AS precio_efectivo,
              fn_cupo_unidad(u.id, d::date, d::date + 1) AS cupo_libre
         FROM unidad_alojamiento u
         CROSS JOIN generate_series($2::date, LEAST($3::date, $2::date + 92), interval '1 day') d
         LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = d::date
        WHERE u.id = $1 ORDER BY d`,
      [unidadId, desde, hasta],
    );
  }

  /** Guarda excepciones del calendario; si un día queda sin precio ni cupo especial, se quita la excepción. */
  async guardarCalendario(unidadId: string, dto: CalendarioDto, user: UsuarioToken): Promise<{ dias: number }> {
    await this.unidadPropia(unidadId, user);
    await this.db.transaccion(async (q) => {
      for (const d of dto.dias) {
        const precio = d.precio_noche ?? null;
        const cupo = d.cantidad_a_la_venta ?? null;
        if (precio === null && cupo === null) {
          await q(`DELETE FROM calendario_unidad WHERE unidad_id = $1 AND fecha = $2`, [unidadId, d.fecha]);
        } else {
          await q(
            `INSERT INTO calendario_unidad (unidad_id, fecha, precio_noche, cantidad_a_la_venta) VALUES ($1, $2, $3, $4)
             ON CONFLICT (unidad_id, fecha) DO UPDATE SET precio_noche = EXCLUDED.precio_noche, cantidad_a_la_venta = EXCLUDED.cantidad_a_la_venta`,
            [unidadId, d.fecha, precio, cupo],
          );
        }
      }
    });
    return { dias: dto.dias.length };
  }

  /** Reservas sobre los alojamientos (todos, para el ADMIN), con método y estado del pago. */
  async reservas(user: UsuarioToken, f: FiltroReservasHostDto): Promise<Listado<ReservaHost>> {
    const filas = await this.db.query<ReservaHost & { total_filas: number; anfitrion_id: string }>(
      `SELECT x.*, count(*) OVER()::int AS total_filas
         FROM (${SQL_RESERVA_HOST}) x
        WHERE ($1::uuid IS NULL OR x.anfitrion_id = $1) AND ($2::text IS NULL OR x.estado = $2)
          AND ($3::text IS NULL OR x.estado_pago = $3)
        ORDER BY x.fecha_entrada DESC LIMIT $4 OFFSET $5`,
      [this.dueno(user), f.estado ?? null, f.estado_pago ?? null, f.limit, f.offset],
    );
    return { items: filas.map(({ total_filas: _t, anfitrion_id: _a, ...x }) => x), total: filas[0]?.total_filas ?? 0, limit: f.limit, offset: f.offset };
  }

  /** Detalle de una reserva (ADMIN): datos, total, método y estado del pago. */
  async reserva(reservaId: string, user: UsuarioToken): Promise<ReservaHost> {
    const f = await this.db.uno<ReservaHost & { anfitrion_id?: string }>(
      `SELECT x.* FROM (${SQL_RESERVA_HOST}) x WHERE x.id = $1 AND ($2::uuid IS NULL OR x.anfitrion_id = $2)`,
      [reservaId, this.dueno(user)],
    );
    if (!f) throw noEncontrado('La reserva no existe');
    const { anfitrion_id: _a, ...x } = f;
    return x;
  }

  /**
   * Confirma que se recibió el pago en EFECTIVO de una reserva (cobros PENDIENTE -> APROBADO).
   * Idempotente: si ya estaba confirmado responde igual. 409 si la reserva no se paga en efectivo o está cancelada.
   */
  async confirmarPago(reservaId: string, user: UsuarioToken): Promise<{ reserva: ReservaHost; ya_confirmado: boolean }> {
    const actual = await this.reserva(reservaId, user);
    if (actual.metodo_pago !== 'EFECTIVO') throw conflicto('La reserva no se paga en efectivo: no hay un pago que confirmar');
    if (actual.estado_pago === 'APROBADO') return { reserva: actual, ya_confirmado: true };
    if (!['CONFIRMADA', 'COMPLETADA'].includes(actual.estado)) {
      throw conflicto(`La reserva está ${actual.estado.toLowerCase()}: no se puede confirmar su pago`);
    }
    await this.db.query(
      `UPDATE pago SET estado = 'APROBADO' WHERE reserva_id = $1 AND metodo = 'EFECTIVO' AND estado = 'PENDIENTE'`,
      [reservaId],
    );
    return { reserva: await this.reserva(reservaId, user), ya_confirmado: false };
  }


  /**
   * Cancelación hecha por el ADMIN (a pedido del huésped o por un problema del alojamiento).
   * Usa fn_cancelar_reserva con el id del admin: como no cancela el huésped, la penalidad es 0 y el reembolso es el 100 % de lo cobrado.
   * Solo reservas PENDIENTES (aún sin confirmar). Las reservas del canal Booking se cancelan por su propio endpoint v2.
   */
  async cancelar(reservaId: string, motivo: unknown, user: UsuarioToken): Promise<{ reserva: ReservaHost; penalidad: number; reembolso: number }> {
    if (motivo !== undefined && (typeof motivo !== 'string' || motivo.length > 300)) {
      throw invalido('Motivo no válido', [{ name: 'motivo', reason: 'texto de hasta 300 caracteres' }]);
    }
    const texto = `Cancelada por el administrador${typeof motivo === 'string' && motivo.trim() ? `: ${motivo.trim()}` : ''}`.slice(0, 300);
    const actual = await this.reserva(reservaId, user);
    if (actual.canal_booking) throw conflicto('Esta reserva viene del canal Booking: se cancela desde ese canal');
    const r = await this.db.transaccion(async (q) => {
      const fila = (await q<{ estado: string; checkin_en: string | null }>(
        `SELECT r.estado::text AS estado, o.checkin_en FROM reserva r LEFT JOIN orden_v2 o ON o.reserva_id = r.id WHERE r.id = $1 FOR UPDATE OF r`,
        [reservaId],
      ))[0];
      if (!fila || fila.estado !== 'PENDIENTE') {
        throw conflicto(`La reserva está ${(fila?.estado ?? 'inexistente').toLowerCase()}: el administrador solo cancela reservas pendientes`);
      }
      if (fila.checkin_en) throw conflicto('El huésped ya llegó: no se puede cancelar');
      return (await q<{ penalidad: number; reembolso: number }>(`SELECT penalidad, reembolso FROM fn_cancelar_reserva($1, $2, $3)`, [reservaId, user.sub, texto]))[0];
    });
    return { reserva: await this.reserva(reservaId, user), penalidad: Number(r?.penalidad ?? 0), reembolso: Number(r?.reembolso ?? 0) };
  }


  /**
   * Check-in en recepción (requisito de la defensa): el recepcionista confirma que el huésped llegó.
   * Solo reservas CONFIRMADAS del canal Booking. Idempotente. Después avisa a Booking
   * (POST /api/v2/reservas/{id}/checkin); si Booking no responde queda en reintentos automáticos.
   */
  async registrarLlegada(reservaId: string, datos: DatosLlegada, user: UsuarioToken): Promise<RespuestaLlegada> {
    const actual = await this.reserva(reservaId, user);
    const fila = await this.db.uno<{ checkin_en: string | null; recepcion: boolean; habitacion: string | null; unidad: string; unidad_id: string; aforo: number }>(
      `SELECT o.checkin_en, o.checkin_recepcion AS recepcion, o.habitacion_asignada AS habitacion, u.nombre AS unidad, u.id::text AS unidad_id,
              (u.capacidad_huespedes * GREATEST(o.cantidad, 1))::int AS aforo
         FROM orden_v2 o JOIN unidad_alojamiento u ON u.id = o.unidad_id WHERE o.reserva_id = $1`,
      [reservaId],
    );
    if (!fila) return this.llegadaDirecta(reservaId, datos, actual, user);
    if (actual.estado !== 'CONFIRMADA') throw conflicto(`La reserva está ${actual.estado.toLowerCase()}: solo una reserva confirmada admite check-in`);

    const errores: { name: string; reason: string }[] = [];
    if (datos.observaciones !== undefined && (typeof datos.observaciones !== 'string' || datos.observaciones.length > 300)) errores.push({ name: 'observaciones', reason: 'máximo 300 caracteres' });
    if (datos.huespedes_reales !== undefined && !(Number.isInteger(datos.huespedes_reales) && datos.huespedes_reales >= 1 && datos.huespedes_reales <= 30)) errores.push({ name: 'huespedes_reales', reason: 'entero de 1 a 30' });
    if (datos.admin_id !== undefined && (typeof datos.admin_id !== 'string' || datos.admin_id.length < 1 || datos.admin_id.length > 80)) errores.push({ name: 'admin_id', reason: '1 a 80 caracteres' });
    if (datos.habitacion !== undefined && (typeof datos.habitacion !== 'string' || datos.habitacion.length > 100)) errores.push({ name: 'habitacion', reason: 'máximo 100 caracteres' });
    if (datos.habitacion_id !== undefined && (typeof datos.habitacion_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datos.habitacion_id))) errores.push({ name: 'habitacion_id', reason: 'UUID' });
    if (datos.habitacion_id !== undefined && (typeof datos.motivo_cambio !== 'string' || !datos.motivo_cambio.trim() || datos.motivo_cambio.length > 200)) {
      errores.push({ name: 'motivo_cambio', reason: 'obligatorio al cambiar de habitación: de 1 a 200 caracteres' });
    }
    if (errores.length) throw invalido('Datos de llegada no válidos', errores);

    // Llegaron más personas de las reservadas: no se bloquea la llegada (el huésped ya está en el mostrador);
    // se deja constancia y el panel ofrece reservar otra habitación para los que no caben.
    const llegaron = datos.huespedes_reales ?? actual.num_huespedes;
    const extra = Math.max(0, llegaron - actual.num_huespedes);

    const yaRegistrado = fila.recepcion;
    let habitacion = fila.habitacion;
    if (!yaRegistrado) {
      await this.db.transaccion(async (q) => {
        // La habitación se fijó al crear la reserva: aquí solo se marca OCUPADA. Recepción puede cambiarla
        // como excepción (avería, limpieza sin terminar) indicando el motivo, siempre dentro del mismo tipo.
        let numero: string | null;
        if (datos.habitacion_id) {
          numero = await cambiarHabitacion(q, reservaId, fila.unidad_id, datos.habitacion_id);
          if (numero === null) throw conflicto('Esa habitación ya no está libre: vuelve a abrir el check-in para ver las disponibles');
        } else {
          numero = await ocuparHabitacionAsignada(q, reservaId);
          if (numero === null) {
            const asignada = await asignarHabitacion(q, reservaId, fila.unidad_id);
            numero = asignada.tipo === 'ASIGNADA' ? asignada.numero : null;
          }
        }
        habitacion = numero !== null ? await etiquetaDeUnidad(q, fila.unidad_id, fila.unidad, numero) : (fila.habitacion ?? fila.unidad).slice(0, 100);
        const nota = datos.habitacion_id ? `Cambio de habitación: ${(datos.motivo_cambio ?? '').trim()}` : null;
        const observaciones = [nota, datos.observaciones?.trim() || null].filter(Boolean).join(' · ') || null;
        await q(
          `UPDATE orden_v2 SET checkin_recepcion = true, checkin_en = COALESCE(checkin_en, now()), habitacion_asignada = $2,
                  checkin_admin = $3, checkin_observaciones = $4, checkin_huespedes = $5
            WHERE reserva_id = $1`,
          [reservaId, habitacion, datos.admin_id ?? (user.email ?? 'recepcionista-hotel').slice(0, 80), observaciones, datos.huespedes_reales ?? null],
        );
        if (!fila.checkin_en) {
          await q(`SELECT fn_emitir_evento('CheckInCompletado', 'Reserva', $1::uuid, $1::uuid, jsonb_build_object('reservaId', $1::text, 'estado', 'CHECKED_IN', 'canal', 'RECEPCION'))`, [reservaId]);
        }
      });
    }
    const notificado = await this.checkin.notificar(reservaId); // idempotente: si ya se avisó, devuelve true sin reenviar
    return {
      reserva: await this.reserva(reservaId, user), estado: 'CHECKED_IN', habitacion_asignada: habitacion ?? '',
      huespedes_extra: extra, aforo_maximo: fila.aforo, ya_registrado: yaRegistrado, booking_notificado: notificado,
    };
  }

  /**
   * Check-in de una reserva directa (canal propio): mismo flujo que el de Booking, pero los datos viven en la
   * propia reserva y no se avisa a nadie fuera del sistema.
   */
  private async llegadaDirecta(reservaId: string, datos: DatosLlegada, actual: ReservaHost, user: UsuarioToken): Promise<RespuestaLlegada> {
    const fila = await this.db.uno<{ checkin_en: string | null; habitacion: string | null; unidad: string; unidad_id: string; aforo: number }>(
      `SELECT r.checkin_en, r.habitacion_asignada AS habitacion, u.nombre AS unidad, u.id::text AS unidad_id,
              (u.capacidad_huespedes * GREATEST(d.cantidad, 1))::int AS aforo
         FROM reserva r JOIN reserva_detalle d ON d.reserva_id = r.id JOIN unidad_alojamiento u ON u.id = d.unidad_id
        WHERE r.id = $1 ORDER BY u.id LIMIT 1`,
      [reservaId],
    );
    if (!fila) throw conflicto('La reserva no tiene un tipo de habitación asignado');
    if (actual.estado !== 'CONFIRMADA') throw conflicto(`La reserva está ${actual.estado.toLowerCase()}: solo una reserva confirmada admite check-in`);

    const errores: { name: string; reason: string }[] = [];
    if (datos.observaciones !== undefined && (typeof datos.observaciones !== 'string' || datos.observaciones.length > 300)) errores.push({ name: 'observaciones', reason: 'máximo 300 caracteres' });
    if (datos.huespedes_reales !== undefined && !(Number.isInteger(datos.huespedes_reales) && datos.huespedes_reales >= 1 && datos.huespedes_reales <= 30)) errores.push({ name: 'huespedes_reales', reason: 'entero de 1 a 30' });
    if (datos.habitacion_id !== undefined && (typeof datos.habitacion_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datos.habitacion_id))) errores.push({ name: 'habitacion_id', reason: 'UUID' });
    if (datos.habitacion_id !== undefined && (typeof datos.motivo_cambio !== 'string' || !datos.motivo_cambio.trim() || datos.motivo_cambio.length > 200)) {
      errores.push({ name: 'motivo_cambio', reason: 'obligatorio al cambiar de habitación: de 1 a 200 caracteres' });
    }
    if (errores.length) throw invalido('Datos de llegada no válidos', errores);

    const llegaron = datos.huespedes_reales ?? actual.num_huespedes;
    const extra = Math.max(0, llegaron - actual.num_huespedes);
    const yaRegistrado = fila.checkin_en !== null;
    let habitacion = fila.habitacion;
    if (!yaRegistrado) {
      await this.db.transaccion(async (q) => {
        let numero: string | null;
        if (datos.habitacion_id) {
          numero = await cambiarHabitacion(q, reservaId, fila.unidad_id, datos.habitacion_id);
          if (numero === null) throw conflicto('Esa habitación ya no está libre: vuelve a abrir el check-in para ver las disponibles');
        } else {
          numero = await ocuparHabitacionAsignada(q, reservaId);
          if (numero === null) {
            const asignada = await asignarHabitacion(q, reservaId, fila.unidad_id);
            numero = asignada.tipo === 'ASIGNADA' ? asignada.numero : null;
          }
        }
        habitacion = numero !== null ? await etiquetaDeUnidad(q, fila.unidad_id, fila.unidad, numero) : (fila.habitacion ?? fila.unidad).slice(0, 100);
        const nota = datos.habitacion_id ? `Cambio de habitación: ${(datos.motivo_cambio ?? '').trim()}` : null;
        const observaciones = [nota, datos.observaciones?.trim() || null].filter(Boolean).join(' · ') || null;
        await q(
          `UPDATE reserva SET checkin_en = COALESCE(checkin_en, now()), habitacion_asignada = $2, checkin_observaciones = $3, checkin_huespedes = $4
            WHERE id = $1`,
          [reservaId, habitacion, observaciones, datos.huespedes_reales ?? null],
        );
      });
    }
    return {
      reserva: await this.reserva(reservaId, user), estado: 'CHECKED_IN', habitacion_asignada: habitacion ?? '',
      huespedes_extra: extra, aforo_maximo: fila.aforo, ya_registrado: yaRegistrado, booking_notificado: false,
    };
  }

  /** Check-out de una reserva directa: COMPLETADA, habitación EN_PREPARACION y cupo recuperado. Idempotente. */
  private async salidaDirecta(reservaId: string, datos: DatosSalida, actual: ReservaHost, user: UsuarioToken): Promise<RespuestaSalida> {
    const fila = await this.db.uno<{ checkin_en: string | null; checkout_en: string | null; consumos_total: string | null }>(
      `SELECT r.checkin_en, r.checkout_en, r.consumos_total::text AS consumos_total FROM reserva r WHERE r.id = $1`,
      [reservaId],
    );
    if (!fila) throw noEncontrado('La reserva no existe');
    if (!fila.checkin_en) throw conflicto('El huésped aún no hizo check-in: registra primero su llegada');
    if (datos.observaciones !== undefined && (typeof datos.observaciones !== 'string' || datos.observaciones.length > 300)) {
      throw invalido('Datos de salida no válidos', [{ name: 'observaciones', reason: 'máximo 300 caracteres' }]);
    }
    const extras = leerConsumos(datos);
    const yaRegistrado = fila.checkout_en !== null;
    let numero: string | null = null;
    if (!yaRegistrado) {
      if (actual.estado !== 'CONFIRMADA' && actual.estado !== 'COMPLETADA') throw conflicto(`La reserva está ${actual.estado.toLowerCase()}: no admite check-out`);
      numero = await this.db.transaccion(async (q) => {
        await q(
          `UPDATE reserva SET checkout_en = now(), checkout_observaciones = $2, consumos = $3::jsonb, consumos_total = $4 WHERE id = $1`,
          [reservaId, (datos.observaciones as string | undefined) ?? null, JSON.stringify(extras.lineas.map((l) => ({ ...l, metodo: extras.metodo }))), aMoney(extras.centavos)],
        );
        if (actual.estado === 'CONFIRMADA') await q(`UPDATE reserva SET estado = 'COMPLETADA' WHERE id = $1`, [reservaId]);
        return pasarAPreparacion(q, reservaId);
      });
    }
    return {
      reserva: await this.reserva(reservaId, user), estado: 'CHECKED_OUT', habitacion_en_preparacion: numero,
      consumos_total: yaRegistrado ? (fila.consumos_total ?? '0.00') : aMoney(extras.centavos), ya_registrado: yaRegistrado, booking_notificado: false,
    };
  }

  /** Habitaciones libres del tipo reservado, para elegir en el check-in. Solo los hoteles eligen: fuera de ellos es_hotel false y lista vacía (se asigna sola la primera libre). */
  /**
   * Datos para el check-in: la habitación ya asignada en la reserva y, por si llegaron más huéspedes
   * de los reservados, los tipos que siguen libres esas mismas fechas para hacerles otra reserva.
   */
  async datosParaCheckin(reservaId: string, user: UsuarioToken): Promise<DatosCheckinHost> {
    const r = await this.reserva(reservaId, user);
    const filaOrden = await this.db.uno<{ unidad_id: string; alojamiento_codigo: number }>(
      `SELECT o.unidad_id::text AS unidad_id, a.codigo::int AS alojamiento_codigo
         FROM orden_v2 o JOIN reserva rs ON rs.id = o.reserva_id JOIN alojamiento a ON a.id = rs.alojamiento_id
        WHERE o.reserva_id = $1`,
      [reservaId],
    );
    const fila = filaOrden ?? (await this.db.uno<{ unidad_id: string; alojamiento_codigo: number }>(
      `SELECT d.unidad_id::text AS unidad_id, a.codigo::int AS alojamiento_codigo
         FROM reserva_detalle d JOIN reserva rs ON rs.id = d.reserva_id JOIN alojamiento a ON a.id = rs.alojamiento_id
        WHERE d.reserva_id = $1 ORDER BY d.unidad_id LIMIT 1`,
      [reservaId],
    ));
    if (!fila) throw conflicto('La reserva no tiene un tipo de habitación asignado');
    const sugerencias = await this.db.query<SugerenciaHabitacion>(
      `SELECT u.codigo_tipo, u.nombre, u.capacidad_huespedes::int AS capacidad, u.precio_noche_base::float8 AS precio_noche,
              fn_cupo_unidad(u.id, $2::date, $3::date)::int AS libres
         FROM unidad_alojamiento u
        WHERE u.alojamiento_id = (SELECT alojamiento_id FROM reserva WHERE id = $1) AND u.activa AND u.id <> $4::uuid
          AND fn_cupo_unidad(u.id, $2::date, $3::date) > 0
        ORDER BY u.precio_noche_base, u.nombre`,
      [reservaId, r.fecha_entrada.slice(0, 10), r.fecha_salida.slice(0, 10), fila.unidad_id],
    );
    const alojamiento = await alojamientoDeUnidad(this.consulta, fila.unidad_id);
    return {
      es_hotel: await esUnidadDeHotel(this.consulta, fila.unidad_id),
      numerada: alojamiento.numerar,
      habitacion_asignada: r.habitacion_asignada,
      alojamiento_codigo: fila.alojamiento_codigo,
      habitaciones_libres: alojamiento.numerar
        ? await habitacionesLibresParaFechas(this.consulta, fila.unidad_id, r.fecha_entrada.slice(0, 10), r.fecha_salida.slice(0, 10))
        : [],
      sugerencias,
    };
  }

  /**
   * Check-out en recepción: el huésped salió. La reserva pasa a COMPLETADA, la habitación queda EN_PREPARACION
   * (el dueño la marca DISPONIBLE cuando esté lista) y se avisa a Booking. Idempotente.
   */
  async registrarSalida(reservaId: string, datos: DatosSalida, user: UsuarioToken): Promise<RespuestaSalida> {
    const actual = await this.reserva(reservaId, user);
    const fila = await this.db.uno<{ checkin_en: string | null; checkout_en: string | null; consumos_total: string | null }>(
      `SELECT o.checkin_en, o.checkout_en, o.consumos_total::text AS consumos_total FROM orden_v2 o WHERE o.reserva_id = $1`,
      [reservaId],
    );
    if (!fila) return this.salidaDirecta(reservaId, datos, actual, user);
    if (!fila.checkin_en) throw conflicto('El huésped aún no hizo check-in: registra primero su llegada');
    if (datos.observaciones !== undefined && (typeof datos.observaciones !== 'string' || datos.observaciones.length > 300)) {
      throw invalido('Datos de salida no válidos', [{ name: 'observaciones', reason: 'máximo 300 caracteres' }]);
    }
    const extras = leerConsumos(datos);
    const yaRegistrado = fila.checkout_en !== null;
    let numero: string | null = null;
    if (!yaRegistrado) {
      if (actual.estado !== 'CONFIRMADA' && actual.estado !== 'COMPLETADA') throw conflicto(`La reserva está ${actual.estado.toLowerCase()}: no admite check-out`);
      numero = await this.db.transaccion(async (q) => {
        await q(
          `UPDATE orden_v2 SET checkout_en = now(), checkout_recepcion = true, checkout_observaciones = $2, clave_digital = NULL,
                  consumos = $3::jsonb, consumos_total = $4 WHERE reserva_id = $1`,
          [reservaId, (datos.observaciones as string | undefined) ?? null, JSON.stringify(extras.lineas.map((l) => ({ ...l, metodo: extras.metodo }))), aMoney(extras.centavos)],
        );
        // El job de estancias puede haberla completado ya al pasar la fecha de salida
        if (actual.estado === 'CONFIRMADA') await q(`UPDATE reserva SET estado = 'COMPLETADA' WHERE id = $1`, [reservaId]);
        return pasarAPreparacion(q, reservaId);
      });
    }
    const notificado = await this.checkout.notificar(reservaId);
    return { reserva: await this.reserva(reservaId, user), estado: 'CHECKED_OUT', habitacion_en_preparacion: numero, consumos_total: yaRegistrado ? (fila.consumos_total ?? '0.00') : aMoney(extras.centavos), ya_registrado: yaRegistrado, booking_notificado: notificado };
  }

  /** Habitaciones de un hotel con su estado. */
  async habitaciones(codigo: number, user: UsuarioToken): Promise<HabitacionHost[]> {
    const alojId = await this.idPropio(codigo, user);
    return this.db.query<HabitacionHost>(
      `SELECT h.id::text AS id, h.numero, h.estado::text AS estado, h.actualizada_en, a.codigo AS alojamiento_codigo, a.nombre AS alojamiento,
              u.nombre AS unidad,
              (SELECT r.codigo FROM reserva r LEFT JOIN orden_v2 o ON o.reserva_id = r.id
                WHERE COALESCE(o.habitacion_id, r.habitacion_id) = h.id AND COALESCE(o.checkin_en, r.checkin_en) IS NOT NULL
                  AND COALESCE(o.checkout_en, r.checkout_en) IS NULL LIMIT 1) AS reserva_codigo,
              pr.codigo AS proxima_codigo, to_char(pr.fecha_entrada, 'YYYY-MM-DD') AS proxima_entrada,
              to_char(pr.fecha_salida, 'YYYY-MM-DD') AS proxima_salida, pr.huesped AS proxima_huesped
         FROM habitacion h
         LEFT JOIN LATERAL (
              SELECT r.codigo, r.fecha_entrada, r.fecha_salida, COALESCE(o.titular->>'nombreCompleto', us.nombres || ' ' || us.apellidos) AS huesped
                FROM reserva r
                LEFT JOIN orden_v2 o ON o.reserva_id = r.id
                LEFT JOIN usuario us ON us.id = r.huesped_id
               WHERE COALESCE(o.habitacion_id, r.habitacion_id) = h.id AND r.estado = 'CONFIRMADA'
                 AND COALESCE(o.checkin_en, r.checkin_en) IS NULL AND r.fecha_salida >= current_date
               ORDER BY r.fecha_entrada LIMIT 1) pr ON true
         JOIN alojamiento a ON a.id = h.alojamiento_id
         JOIN unidad_alojamiento u ON u.id = h.unidad_id
        WHERE h.alojamiento_id = $1::uuid
        ORDER BY u.nombre, length(h.numero), h.numero`,
      [alojId],
    );
  }

  /** El dueño cambia el estado de una habitación: EN_PREPARACION ↔ DISPONIBLE. OCUPADA se libera solo con el check-out. */
  async cambiarEstadoHabitacion(codigo: number, id: string, estado: unknown, user: UsuarioToken): Promise<{ id: string; estado: EstadoHabitacion }> {
    const alojId = await this.idPropio(codigo, user);
    if (typeof estado !== 'string' || !(ESTADOS_EDITABLES as readonly string[]).includes(estado)) {
      throw invalido('Estado no válido', [{ name: 'estado', reason: 'DISPONIBLE o EN_PREPARACION' }]);
    }
    const actual = await this.db.uno<{ estado: EstadoHabitacion }>(`SELECT estado::text AS estado FROM habitacion WHERE id = $1::uuid AND alojamiento_id = $2::uuid`, [id, alojId]);
    if (!actual) throw noEncontrado('La habitación no existe');
    if (actual.estado === 'OCUPADA') throw conflicto('La habitación está ocupada: se libera con el check-out del huésped');
    if (actual.estado !== estado) {
      await this.db.query(`UPDATE habitacion SET estado = $2::estado_habitacion, actualizada_en = now() WHERE id = $1`, [id, estado]);
    }
    return { id, estado: estado as EstadoHabitacion };
  }

  /**
   * Ingresos por mes con desglose: lo que queda para el alojamiento (neto), lo que se entrega al Estado
   * (IVA + tasa municipal) y lo cobrado al huésped (bruto). Para el ADMIN suma todo el catálogo.
   */
  ingresos(user: UsuarioToken): Promise<FilaIngresos[]> {
    return this.db.query<FilaIngresos>(
      `SELECT date_trunc('month', x.fecha)::date::text AS mes,
              count(*) FILTER (WHERE x.estado = 'COMPLETADA')::int AS estancias,
              round(sum(x.neto), 2)::float8       AS ingreso_sin_iva,
              round(sum(x.impuestos), 2)::float8  AS impuestos,
              round(sum(x.neto + x.impuestos), 2)::float8 AS ingreso_bruto
         FROM (SELECT a.anfitrion_id, r.estado::text AS estado,
                      CASE WHEN r.estado = 'COMPLETADA' THEN r.fecha_salida ELSE cn.cancelada_en::date END AS fecha,
                      CASE WHEN r.estado = 'COMPLETADA' THEN t.subtotal_alojamiento + t.servicio + t.limpieza
                           ELSE cl.penalidad END AS neto,
                      CASE WHEN r.estado = 'COMPLETADA' THEN t.iva + COALESCE(o.tasa_municipal, 0) ELSE 0 END AS impuestos
                 FROM reserva r
                 JOIN alojamiento a ON a.id = r.alojamiento_id
                 JOIN v_reserva_total t ON t.reserva_id = r.id
                 LEFT JOIN orden_v2 o ON o.reserva_id = r.id
                 LEFT JOIN cancelacion cn ON cn.reserva_id = r.id
                 LEFT JOIN v_cancelacion_liquidacion cl ON cl.reserva_id = r.id
                WHERE r.estado = 'COMPLETADA' OR (r.estado = 'CANCELADA' AND cl.penalidad > 0)) x
        WHERE ($1::uuid IS NULL OR x.anfitrion_id = $1)
        GROUP BY 1 ORDER BY 1 DESC`,
      [this.dueno(user)],
    );
  }

  /** Reintenta ahora los avisos a Booking que quedaron pendientes (el mismo trabajo que corre solo cada 30 s). */
  async sincronizarBooking(user: UsuarioToken): Promise<{ checkin: number; checkout: number }> {
    if (user.rol !== 'ADMIN') throw conflicto('Solo el administrador puede sincronizar con Booking');
    const [checkin, checkout] = await Promise.all([this.checkin.reintentarPendientes(20), this.checkout.reintentarPendientes(20)]);
    return { checkin, checkout };
  }

  resenas(user: UsuarioToken): Promise<Record<string, unknown>[]> {
    return this.db.query(
      `SELECT rs.id, a.codigo AS alojamiento_codigo, a.nombre AS alojamiento, rs.nota_global, rs.comentario,
              rs.respuesta_anfitrion, rs.respondida_en, rs.created_at, u.nombres || ' ' || left(u.apellidos, 1) || '.' AS autor
         FROM resena rs
         JOIN reserva r ON r.id = rs.reserva_id
         JOIN alojamiento a ON a.id = r.alojamiento_id
         JOIN usuario u ON u.id = r.huesped_id
        WHERE ($1::uuid IS NULL OR a.anfitrion_id = $1) ORDER BY rs.created_at DESC`,
      [this.dueno(user)],
    );
  }

  /** Responder una reseña (una sola vez). */
  async responderResena(resenaId: string, respuesta: string, user: UsuarioToken): Promise<{ id: string }> {
    const fila = await this.db.uno<{ id: string; respondida: boolean }>(
      `SELECT rs.id, rs.respuesta_anfitrion IS NOT NULL AS respondida
         FROM resena rs JOIN reserva r ON r.id = rs.reserva_id JOIN alojamiento a ON a.id = r.alojamiento_id
        WHERE rs.id = $1 AND ($2::uuid IS NULL OR a.anfitrion_id = $2)`,
      [resenaId, this.dueno(user)],
    );
    if (!fila) throw noEncontrado('La reseña no existe');
    if (fila.respondida) throw conflicto('La reseña ya tiene respuesta');
    await this.db.query(`UPDATE resena SET respuesta_anfitrion = $2, respondida_en = now() WHERE id = $1`, [resenaId, respuesta]);
    return { id: resenaId };
  }

  // ---------------------------------------------------------------- utilidades

  private async idPropio(codigo: number, user: UsuarioToken): Promise<string> {
    const f = await this.db.uno<{ id: string }>(
      `SELECT a.id FROM alojamiento a WHERE a.codigo = $1 AND ($2::uuid IS NULL OR a.anfitrion_id = $2)`,
      [codigo, this.dueno(user)],
    );
    if (!f) throw noEncontrado('El alojamiento no existe');
    return f.id;
  }

  private async unidadPropia(unidadId: string, user: UsuarioToken): Promise<void> {
    const f = await this.db.uno(
      `SELECT 1 FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id WHERE u.id = $1 AND ($2::uuid IS NULL OR a.anfitrion_id = $2)`,
      [unidadId, this.dueno(user)],
    );
    if (!f) throw noEncontrado('La unidad no existe');
  }

  private validarNoches(min?: number, max?: number): void {
    if (min !== undefined && max !== undefined && max < min) {
      throw invalido('noches_max debe ser mayor o igual a noches_min', [{ name: 'noches_max', reason: 'menor que noches_min' }]);
    }
  }

  private async reemplazarHijos(q: Consulta, id: string, dto: ActualizarAlojamientoDto): Promise<void> {
    if (dto.amenidades) {
      await q(`DELETE FROM alojamiento_amenidad WHERE alojamiento_id = $1`, [id]);
      if (dto.amenidades.length) {
        await q(`INSERT INTO alojamiento_amenidad (alojamiento_id, amenidad_id) SELECT $1, unnest($2::smallint[]) ON CONFLICT DO NOTHING`, [id, dto.amenidades]);
      }
    }
    if (dto.imagenes) {
      await q(`DELETE FROM imagen_alojamiento WHERE alojamiento_id = $1`, [id]);
      const portada = Math.max(0, dto.imagenes.findIndex((i) => i.es_portada));
      for (const [orden, img] of dto.imagenes.entries()) {
        await q(`INSERT INTO imagen_alojamiento (alojamiento_id, url, orden, es_portada) VALUES ($1, $2, $3, $4)`, [id, img.url, orden, orden === portada]);
      }
    }
  }
}
