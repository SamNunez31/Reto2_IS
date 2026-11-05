import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { cedulaValida } from '../../common/validation/validadores-ec';
import { UsuarioToken } from '../../common/auth/decorators';
import { hoyEcuador, noches as contarNoches } from '../../common/http/respuestas';
import { InvalidParam, ProblemException, invalido } from '../../common/problem/problem';
import { logJson } from '../../common/logging/log-json';
import { DbService } from '../../database/db.service';
import { vincularTitular } from './clientes-v2';
import {
  ComunV2,
  REGIMENES,
  RE_EMAIL,
  RE_MONEY,
  RE_TELEFONO,
  RE_TIPO,
  RE_UUID,
  Titular,
  aCentavos,
  aMoney,
  camposDesconocidos,
  entero,
  esFechaReal,
  iso5,
  lanzarSiHayErrores,
  leerComunes,
  leerTitular,
  noEncontradoV2,
  reglaV2,
  soloObjeto,
} from './util-v2';

const INICIO = Date.now();
const TASA_MUNICIPAL_CENTAVOS = 200; // USD 2.00 por noche y por habitación (contrato v2, §fórmula de precio)
const PLAN_POR_DEFECTO = 'STANDARD';

/** to_char con offset fijo de Guayaquil: 2026-11-01T14:00:00-05:00 */
const TS = (col: string): string => `to_char(${col} AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD"T"HH24:MI:SS"-05:00"')`;

interface FilaCambio {
  id: string; estado: string; huesped_id: string; entrada: string; hora: string; early_checkin: boolean; early_desde: string | null;
  checkin_en: string | null; checkout_en: string | null; habitacion: string | null; identificacion: string | null; tipo_nombre: string;
}

interface FilaAloj {
  id: string;
  codigo: number;
  nombre: string;
  politica_id: number;
  hora_checkin: string;
  noches_min: number;
  noches_max: number;
}
interface FilaUnidad {
  id: string;
  nombre: string;
  codigo_tipo: string;
  capacidad_huespedes: number;
}
interface Noche {
  fecha: string;
  precioC: number; // por habitación
  ivaPct100: number; // porcentaje × 100 (15.00 % = 1500)
}
interface Precio {
  noches: Noche[];
  cantidad: number;
  precioNocheC: number;
  subtotalC: number;
  ivaPct: number;
  ivaC: number;
  tasaC: number;
  descuentoC: number;
  totalC: number;
  nochesDetalle: { fecha: string; precio: string }[];
}

@Injectable()
export class AlojamientosV2Service {
  constructor(private readonly db: DbService) {}

  private get base(): string {
    return `${(process.env.API_PUBLIC_URL || '').replace(/\/$/, '')}/api/v2/alojamientos`;
  }

  // =========================================================================
  // GET /alojamientos/health
  // =========================================================================
  async health(): Promise<{ http: number; cuerpo: Record<string, unknown> }> {
    const t0 = Date.now();
    let conectada = true;
    let metricas: Record<string, number> | undefined;
    let latencia = 0;
    try {
      // La latencia del semáforo mide la respuesta de la BD (ping), no el costo de calcular las métricas.
      await this.db.query('SELECT 1');
      latencia = Date.now() - t0;
      const m = await this.db.uno<{ props: number; hab: number; ocu: number }>(
        `SELECT (SELECT count(*) FROM alojamiento WHERE estado = 'PUBLICADO')::int AS props,
                (SELECT COALESCE(sum(u.cantidad), 0) FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id
                  WHERE u.activa AND a.estado = 'PUBLICADO')::int AS hab,
                (SELECT COALESCE(sum(d.cantidad), 0) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                  WHERE r.estado IN ('PENDIENTE','CONFIRMADA') AND r.fecha_entrada <= $1::date AND r.fecha_salida > $1::date)::int AS ocu`,
        [hoyEcuador()],
      );
      if (m) {
        const pct = m.hab > 0 ? Math.round((m.ocu / m.hab) * 10000) / 100 : 0;
        metricas = { total_propiedades: m.props, habitaciones_totales: m.hab, habitaciones_ocupadas: m.ocu, tasa_ocupacion_pct: pct };
      }
    } catch (e) {
      conectada = false;
      logJson('error', 'health_bd_caida', { error: e instanceof Error ? e.message : String(e) });
    }
    if (!conectada) latencia = Date.now() - t0;
    const semaforo = !conectada || latencia > 800 ? 'RED' : latencia >= 200 ? 'YELLOW' : 'GREEN';
    const status = !conectada ? 'DOWN' : semaforo === 'GREEN' ? 'HEALTHY' : 'DEGRADED';
    return {
      http: conectada ? 200 : 503,
      cuerpo: {
        status,
        semaforo,
        service: 'MS_ALOJAMIENTOS',
        vertical: 'ALOJAMIENTOS',
        ...(process.env.NODE_ID ? { nodo_id: process.env.NODE_ID } : {}),
        servicio: process.env.SERVICE_ROLE || 'all',
        version: '2.2.0',
        latency_ms: latencia,
        uptime_seconds: Math.floor((Date.now() - INICIO) / 1000),
        database: { status: conectada ? 'CONNECTED' : 'DISCONNECTED' },
        circuit_breaker: 'CLOSED',
        ...(metricas ? { metrics: metricas } : {}),
        timestamp: iso5(Date.now()),
      },
    };
  }

  // =========================================================================
  // GET /alojamientos  (catálogo paginado)
  // =========================================================================
  async catalogo(q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    const pagina = q.page === undefined ? 1 : Number(q.page);
    const limite = q.limit === undefined ? 10 : Number(q.limit);
    if (!entero(pagina, 1, 1_000_000)) errores.push({ name: 'page', reason: 'entero ≥ 1' });
    if (!entero(limite, 1, 50)) errores.push({ name: 'limit', reason: 'entero entre 1 y 50' });
    if (q.estrellas !== undefined && !entero(Number(q.estrellas), 1, 5)) errores.push({ name: 'estrellas', reason: 'entero entre 1 y 5' });
    for (const campo of ['minPrecio', 'maxPrecio']) {
      if (q[campo] !== undefined && !RE_MONEY.test(q[campo] as string)) errores.push({ name: campo, reason: 'importe Money, p. ej. "120.00"' });
    }
    if (q.actualizadoDesde !== undefined && Number.isNaN(Date.parse(q.actualizadoDesde))) errores.push({ name: 'actualizadoDesde', reason: 'fecha RFC 3339' });
    lanzarSiHayErrores(errores);

    const where: string[] = [`a.estado = 'PUBLICADO'`];
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.ciudad) where.push(`c.nombre ILIKE ${p(q.ciudad)}`);
    if (q.estrellas) where.push(`a.categoria_estrellas = ${p(Number(q.estrellas))}`);
    if (q.minPrecio) where.push(`r.precio_desde >= ${p(q.minPrecio)}::numeric`);
    if (q.maxPrecio) where.push(`r.precio_desde <= ${p(q.maxPrecio)}::numeric`);
    if (q.permitePaquete === 'true') where.push('false'); // este nodo aún no acepta combos
    if (q.actualizadoDesde) where.push(`a.updated_at >= ${p(new Date(q.actualizadoDesde))}`);
    const filtro = where.join(' AND ');
    const desde = `FROM alojamiento a
        JOIN v_alojamiento_resumen r ON r.id = a.id
        JOIN tipo_alojamiento ta ON ta.id = a.tipo_id
        JOIN ciudad c ON c.id = a.ciudad_id
       WHERE ${filtro}`;

    const total = (await this.db.uno<{ n: number }>(`SELECT count(*)::int AS n ${desde}`, params))?.n ?? 0;
    const filas = await this.db.query<{
      codigo: number;
      nombre: string;
      tipo: string;
      destino: string;
      direccion: string;
      estrellas: number;
      calificacion: string | null;
      num_resenas: number;
      precio: string | null;
      hora_checkin: string;
      hora_checkout: string;
      actualizado: string;
      fotos: string[] | null;
      amenidades: string[] | null;
    }>(
      `SELECT a.codigo, a.nombre, ta.nombre AS tipo, c.nombre AS destino, a.direccion,
              COALESCE(a.categoria_estrellas, 1)::int AS estrellas,
              r.calificacion::text AS calificacion, r.num_resenas::int AS num_resenas, r.precio_desde::text AS precio,
              a.hora_checkin::text AS hora_checkin, a.hora_checkout::text AS hora_checkout, ${TS('a.updated_at')} AS actualizado,
              (SELECT array_agg(i.url ORDER BY i.es_portada DESC, i.orden) FROM imagen_alojamiento i WHERE i.alojamiento_id = a.id) AS fotos,
              (SELECT array_agg(am.nombre ORDER BY am.nombre) FROM alojamiento_amenidad aa JOIN amenidad am ON am.id = aa.amenidad_id
                WHERE aa.alojamiento_id = a.id) AS amenidades
         ${desde}
        ORDER BY a.codigo
        LIMIT ${p(limite)} OFFSET ${p((pagina - 1) * limite)}`,
      params,
    );
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    const data = filas.map((f) => ({
      id: `HTL-${f.codigo}`,
      nombre: f.nombre,
      ...(tipoPropiedad(f.tipo) ? { tipoPropiedad: tipoPropiedad(f.tipo) } : {}),
      destino: f.destino,
      direccion: f.direccion,
      estrellas: f.estrellas,
      ...(f.calificacion ? { scoreCalificacion: Number(f.calificacion) } : {}),
      totalResenas: f.num_resenas,
      precioPorNoche: aMoney(aCentavos(f.precio ?? '0')),
      moneda: 'USD',
      permitePaquete: false,
      descuentoMaximo: 0,
      checkInPermitidoDesde: f.hora_checkin.slice(0, 5),
      checkOutHoraMaxima: f.hora_checkout.slice(0, 5),
      fotos: f.fotos ?? [],
      amenidades: f.amenidades ?? [],
      actualizadoEn: f.actualizado,
    }));
    return {
      metadata: { total_results: total, page: pagina, limit: limite, total_pages: totalPaginas, has_next: pagina < totalPaginas },
      data,
      total,
      page: pagina,
      limit: limite,
      _links: { self: { href: `${this.base}?page=${pagina}&limit=${limite}`, method: 'GET' } },
    };
  }

  // =========================================================================
  // POST /alojamientos/availability  (cotización con precio congelado 30 min)
  // =========================================================================
  async disponibilidad(cuerpo: unknown): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(
      b,
      ['alojamientoId', 'fechaInicio', 'fechaFin', 'tipoHabitacionCodigo', 'cantidadHabitaciones', 'ocupantes', 'regimenSeleccionado', 'currency', 'planTarifaCodigo'],
      errores,
    );
    const c = leerComunes(b, errores);
    lanzarSiHayErrores(errores);

    const { aloj, unidad } = await this.resolverUnidad(c);
    this.validarReglas(c, aloj, unidad);
    const plan = c.planTarifaCodigo ?? PLAN_POR_DEFECTO;

    const cupo = (await this.db.uno<{ n: number }>(`SELECT fn_cupo_unidad($1, $2::date, $3::date)::int AS n`, [unidad.id, c.fechaInicio, c.fechaFin]))?.n ?? 0;
    if (cupo < c.cantidadHabitaciones) {
      throw new ProblemException(409, 'OUT_OF_STOCK', `No hay ${c.cantidadHabitaciones} habitación(es) ${c.tipoHabitacionCodigo} para esas fechas`);
    }
    const precio = await this.calcularPrecio(unidad.id, aloj.id, c.fechaInicio, c.fechaFin, c.cantidadHabitaciones);
    const cot = await this.db.uno<{ id: string; valida_hasta: string }>(
      `INSERT INTO cotizacion_v2 (unidad_id, fecha_entrada, fecha_salida, cantidad, plan_tarifa, subtotal, iva_porcentaje, iva_valor,
                                  tasa_municipal, descuento_combo, total, noches_detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       RETURNING id::text AS id, ${TS('valida_hasta')} AS valida_hasta`,
      [
        unidad.id, c.fechaInicio, c.fechaFin, c.cantidadHabitaciones, plan,
        aMoney(precio.subtotalC), precio.ivaPct, aMoney(precio.ivaC), aMoney(precio.tasaC), aMoney(precio.descuentoC), aMoney(precio.totalC),
        JSON.stringify(precio.nochesDetalle),
      ],
    );
    return {
      alojamientoId: `HTL-${aloj.codigo}`,
      tipoHabitacionCodigo: unidad.codigo_tipo,
      estaDisponible: true,
      habitacionesRemanentes: cupo,
      nochesEstancia: precio.noches.length,
      desglosePrecio: desglose(precio),
      precioTotalCotizado: aMoney(precio.totalC),
      cotizacionId: cot?.id,
      tarifaValidaHasta: cot?.valida_hasta,
      currency: 'USD',
      planTarifaCodigo: plan,
      modeloPago: 'PREPAGO',
      politicaCancelacion: await this.politica(aloj.politica_id),
      _links: { create: { href: `${this.base}/orders/create`, method: 'POST', description: 'Crear la reserva con este cotizacionId' } },
    };
  }

  // =========================================================================
  // POST /alojamientos/orders/create
  // =========================================================================
  async crearOrden(cuerpo: unknown, usuario: UsuarioToken, claveIdem: string): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(
      b,
      ['alojamientoId', 'tipoHabitacionCodigo', 'fechaInicio', 'fechaFin', 'cantidadHabitaciones', 'ocupantes', 'regimenSeleccionado', 'cotizacionId',
        'totalPagar', 'currency', 'paquete', 'payment_method', 'payment_reference', 'saga_id', 'idempotency_key', 'huespedTitular', 'customer_contact',
        'huespedesAdicionales', 'peticionesEspeciales', 'planTarifaCodigo'],
      errores,
    );
    const c = leerComunes(b, errores);
    if (!c.ocupantes) errores.push({ name: 'ocupantes', reason: 'obligatorio' });
    if (typeof b.totalPagar !== 'string' || !RE_MONEY.test(b.totalPagar)) errores.push({ name: 'totalPagar', reason: 'obligatorio; importe Money, p. ej. "560.00"' });
    if (b.cotizacionId !== undefined && (typeof b.cotizacionId !== 'string' || !RE_UUID.test(b.cotizacionId))) errores.push({ name: 'cotizacionId', reason: 'UUID' });
    if (b.payment_method !== undefined && !['TARJETA_CREDITO', 'TARJETA_DEBITO', 'TRANSFERENCIA', 'SIMULADO', 'PAGO_EN_SITIO'].includes(b.payment_method as string))
      errores.push({ name: 'payment_method', reason: 'TARJETA_CREDITO, TARJETA_DEBITO, TRANSFERENCIA, SIMULADO o PAGO_EN_SITIO' });
    if (b.payment_reference !== undefined && (typeof b.payment_reference !== 'string' || b.payment_reference.length > 64)) errores.push({ name: 'payment_reference', reason: 'máximo 64 caracteres' });
    if (b.saga_id !== undefined && (typeof b.saga_id !== 'string' || b.saga_id.length > 64)) errores.push({ name: 'saga_id', reason: 'máximo 64 caracteres' });
    if (b.peticionesEspeciales !== undefined && (typeof b.peticionesEspeciales !== 'string' || b.peticionesEspeciales.length > 500)) errores.push({ name: 'peticionesEspeciales', reason: 'máximo 500 caracteres' });
    if (b.huespedesAdicionales !== undefined && (!Array.isArray(b.huespedesAdicionales) || b.huespedesAdicionales.length > 20)) errores.push({ name: 'huespedesAdicionales', reason: 'arreglo de máximo 20' });
    const titular = leerTitular(b, errores);
    lanzarSiHayErrores(errores);

    // --- 404: recursos --------------------------------------------------------
    const { aloj, unidad } = await this.resolverUnidad(c);
    const plan = c.planTarifaCodigo ?? PLAN_POR_DEFECTO;

    // --- 422: reglas de negocio ------------------------------------------------
    if (b.idempotency_key !== undefined && b.idempotency_key !== claveIdem) {
      throw reglaV2('VALIDATION_FAILED', 'idempotency_key del cuerpo debe ser igual a la cabecera Idempotency-Key', [{ name: 'idempotency_key', reason: 'distinta de la cabecera' }]);
    }
    this.validarReglas(c, aloj, unidad);
    const t = titular as Titular;
    if (t.tipoDocumento === 'CEDULA' && !cedulaValida(t.identificacion)) {
      throw reglaV2('INVALID_DOCUMENT', 'La cédula no supera la verificación módulo 10.', [{ name: 'huespedTitular.identificacion', reason: 'cédula inválida' }]);
    }
    if (b.paquete !== undefined) {
      throw reglaV2('PROMOTIONS_NOT_ALLOWED', 'Este nodo no acepta paquetes/promociones por ahora (permite_promociones=false).');
    }

    // --- 409: precio y cotización ---------------------------------------------
    let cotizacionId: string | undefined;
    let precio: Precio;
    if (b.cotizacionId) {
      const cot = await this.db.uno<{
        id: string; unidad_id: string; entrada: string; salida: string; cantidad: number; vigente: boolean; valida_hasta: string;
        subtotal: string; iva_porcentaje: string; iva_valor: string; tasa: string; descuento: string; total: string; noches: { fecha: string; precio: string }[];
      }>(
        `SELECT id::text AS id, unidad_id::text AS unidad_id, fecha_entrada::text AS entrada, fecha_salida::text AS salida, cantidad::int AS cantidad,
                (valida_hasta >= now()) AS vigente, ${TS('valida_hasta')} AS valida_hasta,
                subtotal::text, iva_porcentaje::text, iva_valor::text, tasa_municipal::text AS tasa, descuento_combo::text AS descuento, total::text, noches_detalle AS noches
           FROM cotizacion_v2 WHERE id = $1`,
        [b.cotizacionId],
      );
      if (!cot) throw noEncontradoV2(`La cotización ${String(b.cotizacionId)} no existe`);
      if (cot.unidad_id !== unidad.id || cot.entrada !== c.fechaInicio || cot.salida !== c.fechaFin || cot.cantidad !== c.cantidadHabitaciones) {
        throw reglaV2('VALIDATION_FAILED', 'La cotización no corresponde a la habitación, fechas o cantidad de esta reserva', [{ name: 'cotizacionId', reason: 'no coincide con la petición' }]);
      }
      if (!cot.vigente) {
        throw new ProblemException(409, 'QUOTE_EXPIRED', `La cotización ${cot.id} venció a las ${cot.valida_hasta}.`);
      }
      cotizacionId = cot.id;
      const nochesDet = cot.noches;
      precio = {
        noches: [], cantidad: cot.cantidad, precioNocheC: aCentavos(nochesDet[0]?.precio ?? '0') / cot.cantidad,
        subtotalC: aCentavos(cot.subtotal), ivaPct: Number(cot.iva_porcentaje), ivaC: aCentavos(cot.iva_valor), tasaC: aCentavos(cot.tasa),
        descuentoC: aCentavos(cot.descuento), totalC: aCentavos(cot.total), nochesDetalle: nochesDet,
      };
    } else {
      precio = await this.calcularPrecio(unidad.id, aloj.id, c.fechaInicio, c.fechaFin, c.cantidadHabitaciones);
    }
    if (aCentavos(b.totalPagar as string) !== precio.totalC) {
      throw new ProblemException(409, 'PRICE_MISMATCH', `totalPagar=${b.totalPagar as string} pero la tarifa vigente es ${aMoney(precio.totalC)}.`);
    }

    // --- Transacción: reserva + detalle (el trigger bloquea la unidad y valida el cupo) + pago + datos del canal ---
    const ocupantes = c.ocupantes as { adultos: number; ninos: number };
    const huespedes = ocupantes.adultos + ocupantes.ninos;
    const reservaId = await this.db.transaccion(async (q) => {
      const r = await q<{ id: string }>(
        `INSERT INTO reserva (huesped_id, alojamiento_id, politica_id, fecha_entrada, fecha_salida, num_huespedes, modo, expira_en,
                              tarifa_limpieza_aplicada, iva_limpieza, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'INSTANTANEA', NULL, 0, 0, 'CONFIRMADA') RETURNING id::text AS id`,
        [usuario.sub, aloj.id, aloj.politica_id, c.fechaInicio, c.fechaFin, huespedes],
      );
      const id = r[0].id;
      await q(
        `INSERT INTO reserva_detalle (reserva_id, unidad_id, cantidad, subtotal_alojamiento, servicio_monto, iva_monto)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [id, unidad.id, c.cantidadHabitaciones, aMoney(precio.subtotalC), aMoney(precio.ivaC)],
      );
      await q(
        `INSERT INTO pago (reserva_id, tipo, monto, referencia) VALUES ($1, 'COBRO', $2, $3)`,
        [id, aMoney(precio.totalC), ((b.payment_reference as string | undefined) ?? 'SIM-ORD').slice(0, 60)],
      );
      await q(
        `INSERT INTO orden_v2 (reserva_id, cotizacion_id, unidad_id, cantidad, saga_id, plan_tarifa, regimen, ocupantes, titular, acompanantes,
                               peticiones, payment_method, payment_reference, subtotal, iva_porcentaje, iva_valor, tasa_municipal,
                               descuento_combo, total, noches_detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb)`,
        [
          id, cotizacionId ?? null, unidad.id, c.cantidadHabitaciones, (b.saga_id as string | undefined) ?? null, plan, c.regimenSeleccionado ?? null,
          JSON.stringify(ocupantes), JSON.stringify(t), b.huespedesAdicionales ? JSON.stringify(b.huespedesAdicionales) : null,
          (b.peticionesEspeciales as string | undefined) ?? null, (b.payment_method as string | undefined) ?? null, (b.payment_reference as string | undefined) ?? null,
          aMoney(precio.subtotalC), precio.ivaPct, aMoney(precio.ivaC), aMoney(precio.tasaC), aMoney(precio.descuentoC), aMoney(precio.totalC),
          JSON.stringify(precio.nochesDetalle),
        ],
      );
      return id;
    });
    await vincularTitular((sql, p) => this.db.query(sql, p), reservaId, t); // ficha del huésped (no duplica; nunca rompe la reserva)
    logJson('info', 'orden_v2_creada', { reserva_id: reservaId, saga_id: (b.saga_id as string | undefined) ?? null, total: aMoney(precio.totalC) });
    return this.detalleOrden(`reserva.id = $1`, [reservaId]);
  }

  // =========================================================================
  // GET /alojamientos/orders/{orderId}
  // =========================================================================
  async obtenerOrden(ref: string, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const [cond, valor] = condicionDeReferencia(ref);
    const orden = await this.detalleOrden(cond, [valor], usuario);
    return orden;
  }

  // =========================================================================
  // POST /alojamientos/orders/{orderId}/cancel
  // =========================================================================
  async cancelarOrden(ref: string, cuerpo: unknown, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const b = cuerpo === undefined || cuerpo === null || (typeof cuerpo === 'object' && Object.keys(cuerpo as object).length === 0) ? {} : soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['motivo', 'solicitadoPor'], errores);
    if (b.motivo !== undefined && (typeof b.motivo !== 'string' || b.motivo.length > 300)) errores.push({ name: 'motivo', reason: 'máximo 300 caracteres' });
    const solicitadoPor = (b.solicitadoPor as string | undefined) ?? 'CLIENTE';
    if (!['SAGA_ORCHESTRATOR', 'CLIENTE', 'ADMIN', 'HOTEL'].includes(solicitadoPor)) errores.push({ name: 'solicitadoPor', reason: 'SAGA_ORCHESTRATOR, CLIENTE, ADMIN u HOTEL' });
    lanzarSiHayErrores(errores);
    const [cond, valor] = condicionDeReferencia(ref);

    const res = await this.db.transaccion(async (q) => {
      const fila = await q<{ id: string; estado: string; huesped_id: string; codigo: string; en_casa: boolean }>(
        `SELECT r.id::text AS id, r.estado::text AS estado, r.huesped_id::text AS huesped_id, r.codigo, (o.checkin_en IS NOT NULL) AS en_casa
           FROM reserva r JOIN orden_v2 o ON o.reserva_id = r.id WHERE ${cond.replace(/reserva\.id/, 'r.id').replace(/reserva\.codigo/, 'r.codigo')} FOR UPDATE OF r`,
        [valor],
      );
      if (!fila.length) throw noEncontradoV2(`La reserva ${ref} no existe`);
      const r = fila[0];
      if (r.huesped_id !== usuario.sub && usuario.rol !== 'ADMIN') throw new ProblemException(403, 'FORBIDDEN', 'La reserva pertenece a otro cliente');

      if (r.en_casa && r.estado === 'CONFIRMADA') {
        throw new ProblemException(409, 'INVALID_STATE_TRANSITION', 'No se puede cancelar una reserva en estado CHECKED_IN.');
      }
      if (r.estado === 'COMPLETADA') {
        throw new ProblemException(409, 'INVALID_STATE_TRANSITION', 'No se puede cancelar una reserva en estado CHECKED_OUT.');
      }
      let yaCancelada = true;
      if (r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA') {
        yaCancelada = false;
        await q(`INSERT INTO cancelacion (reserva_id, cancelada_por, motivo) VALUES ($1, $2, $3)`, [r.id, usuario.sub, (b.motivo as string | undefined) ?? null]);
        const pagado = aCentavos((await q<{ s: string }>(`SELECT COALESCE(sum(monto), 0)::text AS s FROM pago WHERE reserva_id = $1 AND tipo = 'COBRO' AND estado = 'APROBADO'`, [r.id]))[0].s);
        let penalidadC = 0;
        if (solicitadoPor === 'CLIENTE') {
          const liq = await q<{ penalidad: string }>(`SELECT penalidad::text AS penalidad FROM v_cancelacion_liquidacion WHERE reserva_id = $1`, [r.id]);
          penalidadC = aCentavos(liq[0]?.penalidad ?? '0');
        }
        const reembolsoC = pagado - penalidadC;
        const pctReembolso = pagado > 0 ? Math.round((reembolsoC / pagado) * 10000) / 100 : 0;
        await q(`UPDATE reserva SET estado = 'CANCELADA', expira_en = NULL WHERE id = $1`, [r.id]);
        const codigo = (await q<{ c: string }>(`SELECT 'REF-HTL-' || lpad(nextval('seq_reembolso_htl')::text, 6, '0') AS c`))[0].c;
        if (reembolsoC > 0) await q(`INSERT INTO pago (reserva_id, tipo, monto, referencia) VALUES ($1, 'REEMBOLSO', $2, $3)`, [r.id, aMoney(reembolsoC), codigo]);
        await q(
          `UPDATE orden_v2 SET codigo_reembolso = $2, porcentaje_reembolso = $3, monto_reembolsado = $4, penalidad = $5,
                  solicitado_por = $6, motivo_cancelacion = $7, cancelada_en = now() WHERE reserva_id = $1`,
          [r.id, codigo, pctReembolso, aMoney(reembolsoC), aMoney(penalidadC), solicitadoPor, (b.motivo as string | undefined) ?? null],
        );
      } else {
        // EXPIRADA / RECHAZADA / CANCELADA: se reporta como cancelada; si nunca tuvo código de reembolso se le asigna uno (estable desde ahora)
        await q(
          `UPDATE orden_v2 SET codigo_reembolso = COALESCE(codigo_reembolso, 'REF-HTL-' || lpad(nextval('seq_reembolso_htl')::text, 6, '0')),
                  porcentaje_reembolso = COALESCE(porcentaje_reembolso, 0), monto_reembolsado = COALESCE(monto_reembolsado, 0),
                  penalidad = COALESCE(penalidad, 0), cancelada_en = COALESCE(cancelada_en, now()) WHERE reserva_id = $1`,
          [r.id],
        );
      }
      const o = (
        await q<{
          external: string; codigo_reembolso: string; pct: string; monto: string; pen: string; solicitado: string | null; ts: string; orden_id: string;
        }>(
          `SELECT r.codigo AS external, o.codigo_reembolso, o.porcentaje_reembolso::text AS pct, o.monto_reembolsado::text AS monto, o.penalidad::text AS pen,
                  o.solicitado_por AS solicitado, ${TS('o.cancelada_en')} AS ts, r.id::text AS orden_id
             FROM orden_v2 o JOIN reserva r ON r.id = o.reserva_id WHERE o.reserva_id = $1`,
          [r.id],
        )
      )[0];
      const monto = aCentavos(o.monto);
      const refundStatus = o.solicitado === 'SAGA_ORCHESTRATOR' ? 'COMPENSATED' : monto > 0 ? 'REFUNDED' : 'NO_REFUND';
      return {
        orderId: o.orden_id,
        external_order_id: `ORD-HTL-${o.external.slice(3)}`,
        estado: 'CANCELLED',
        refundStatus,
        codigoReembolso: o.codigo_reembolso,
        porcentajeReembolso: Number(o.pct),
        montoReembolsado: aMoney(monto),
        penalidad: aMoney(aCentavos(o.pen)),
        cuposRestaurados: true,
        yaCancelada,
        timestamp: o.ts,
        _links: { self: { href: `${this.base}/orders/${o.orden_id}`, method: 'GET' } },
      };
    });
    logJson('info', 'orden_v2_cancelada', { order_id: res.orderId, ya_cancelada: res.yaCancelada });
    return res;
  }

  // =========================================================================
  // GET /alojamientos/{id}/inventario  (fuente de verdad para reconciliar el stock gRPC)
  // =========================================================================
  async inventario(idPublico: string, q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    if (!esFechaReal(q.desde)) errores.push({ name: 'desde', reason: 'obligatoria; formato YYYY-MM-DD' });
    if (!esFechaReal(q.hasta)) errores.push({ name: 'hasta', reason: 'obligatoria; formato YYYY-MM-DD' });
    if (q.tipoHabitacion !== undefined && !RE_TIPO.test(q.tipoHabitacion)) errores.push({ name: 'tipoHabitacion', reason: 'patrón ^[A-Z0-9_]{2,40}$' });
    lanzarSiHayErrores(errores);
    const desde = q.desde as string;
    const hasta = q.hasta as string;
    const dias = contarNoches(desde, hasta) + 1; // [desde, hasta] inclusive
    if (dias < 1) throw reglaV2('VALIDATION_FAILED', 'hasta debe ser igual o posterior a desde.', [{ name: 'hasta', reason: 'anterior a desde' }]);
    if (dias > 92) throw reglaV2('VALIDATION_FAILED', 'El rango máximo es de 92 noches.', [{ name: 'hasta', reason: 'más de 92 noches' }]);
    const m = /^HTL-(\d{1,9})$/i.exec(idPublico);
    const aloj = m ? await this.db.uno<{ id: string; codigo: number }>(`SELECT id::text AS id, codigo FROM alojamiento WHERE codigo = $1`, [Number(m[1])]) : null;
    if (!aloj) throw noEncontradoV2(`El alojamiento ${idPublico} no existe`);
    const filas = await this.db.query<{ fecha: string; tipo: string; total: number; reservadas: number; bloqueadas: number; disponibles: number }>(
      `SELECT n::date::text AS fecha, u.codigo_tipo AS tipo, u.cantidad::int AS total,
              COALESCE((SELECT sum(d.cantidad) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                         WHERE d.unidad_id = u.id AND r.estado IN ('PENDIENTE','CONFIRMADA','COMPLETADA')
                           AND r.fecha_entrada <= n::date AND r.fecha_salida > n::date), 0)::int AS reservadas,
              GREATEST(u.cantidad - COALESCE(c.cantidad_a_la_venta, u.cantidad), 0)::int AS bloqueadas,
              GREATEST(COALESCE(c.cantidad_a_la_venta, u.cantidad)
                - COALESCE((SELECT sum(d.cantidad) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                             WHERE d.unidad_id = u.id AND r.estado IN ('PENDIENTE','CONFIRMADA','COMPLETADA')
                               AND r.fecha_entrada <= n::date AND r.fecha_salida > n::date), 0), 0)::int AS disponibles
         FROM unidad_alojamiento u
        CROSS JOIN generate_series($2::date, $3::date, interval '1 day') n
         LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
        WHERE u.alojamiento_id = $1 AND u.activa AND ($4::text IS NULL OR u.codigo_tipo = $4)
        ORDER BY n, u.codigo_tipo`,
      [aloj.id, desde, hasta, q.tipoHabitacion ?? null],
    );
    if (q.tipoHabitacion && filas.length === 0) throw noEncontradoV2(`El tipo de habitación ${q.tipoHabitacion} no existe en ${idPublico}`);
    const noches = filas.map((f) => ({ fecha: f.fecha, tipoHabitacionCodigo: f.tipo, habitacionesTotales: f.total, reservadas: f.reservadas, bloqueadas: f.bloqueadas, disponibles: f.disponibles }));
    // Huella SHA-256 del contenido (el contrato no fija el algoritmo; se documenta aquí y se confirma con Booking)
    const hash = createHash('sha256').update(JSON.stringify(noches)).digest('hex');
    return { alojamientoId: `HTL-${aloj.codigo}`, desde, hasta, generadoEn: iso5(Date.now()), hash, noches };
  }

  // =========================================================================
  // POST /alojamientos/search  (búsqueda con fechas y ocupantes; no retiene inventario ni congela precio)
  // =========================================================================
  async buscar(cuerpo: unknown, q: Record<string, string | undefined>, requestId: string): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(
      b,
      ['destino', 'fechaInicio', 'fechaFin', 'adultos', 'ninos', 'edadesNinos', 'habitaciones', 'estrellasMinimas', 'precioMaximo', 'amenidadesDeseadas', 'regimen', 'permitePaquete', 'currency'],
      errores,
    );
    const pagina = q.page === undefined ? 1 : Number(q.page);
    const limite = q.limit === undefined ? 10 : Number(q.limit);
    if (!entero(pagina, 1, 1_000_000)) errores.push({ name: 'page', reason: 'entero ≥ 1' });
    if (!entero(limite, 1, 50)) errores.push({ name: 'limit', reason: 'entero entre 1 y 50' });
    if (typeof b.destino !== 'string' || b.destino.trim().length < 2 || b.destino.length > 80) errores.push({ name: 'destino', reason: 'texto de 2 a 80 caracteres' });
    if (!esFechaReal(b.fechaInicio)) errores.push({ name: 'fechaInicio', reason: 'fecha AAAA-MM-DD' });
    if (!esFechaReal(b.fechaFin)) errores.push({ name: 'fechaFin', reason: 'fecha AAAA-MM-DD' });
    if (!entero(b.adultos, 1, 20)) errores.push({ name: 'adultos', reason: 'entero entre 1 y 20' });
    if (b.ninos !== undefined && !entero(b.ninos, 0, 10)) errores.push({ name: 'ninos', reason: 'entero entre 0 y 10' });
    if (b.habitaciones !== undefined && !entero(b.habitaciones, 1, 10)) errores.push({ name: 'habitaciones', reason: 'entero entre 1 y 10' });
    if (b.edadesNinos !== undefined && (!Array.isArray(b.edadesNinos) || b.edadesNinos.length > 10 || b.edadesNinos.some((e) => !entero(e, 0, 17)))) {
      errores.push({ name: 'edadesNinos', reason: 'lista de hasta 10 edades entre 0 y 17' });
    }
    if (b.estrellasMinimas !== undefined && !entero(b.estrellasMinimas, 1, 5)) errores.push({ name: 'estrellasMinimas', reason: 'entero entre 1 y 5' });
    if (b.precioMaximo !== undefined && !(typeof b.precioMaximo === 'string' && RE_MONEY.test(b.precioMaximo))) errores.push({ name: 'precioMaximo', reason: 'importe Money, p. ej. "120.00"' });
    if (b.regimen !== undefined && !REGIMENES.includes(String(b.regimen))) errores.push({ name: 'regimen', reason: `uno de ${REGIMENES.join(', ')}` });
    if (b.amenidadesDeseadas !== undefined && (!Array.isArray(b.amenidadesDeseadas) || b.amenidadesDeseadas.length > 20 || b.amenidadesDeseadas.some((a) => typeof a !== 'string' || a.length > 60))) {
      errores.push({ name: 'amenidadesDeseadas', reason: 'lista de hasta 20 textos de máximo 60 caracteres' });
    }
    if (b.permitePaquete !== undefined && typeof b.permitePaquete !== 'boolean') errores.push({ name: 'permitePaquete', reason: 'booleano' });
    lanzarSiHayErrores(errores);

    if ((b.currency ?? 'USD') !== 'USD') throw reglaV2('UNSUPPORTED_CURRENCY', 'Este nodo opera solo en USD.');
    const inicio = b.fechaInicio as string;
    const fin = b.fechaFin as string;
    const n = contarNoches(inicio, fin);
    if (n <= 0) throw reglaV2('VALIDATION_FAILED', 'fechaFin debe ser posterior a fechaInicio.', [{ name: 'fechaFin', reason: 'Debe ser estrictamente posterior a fechaInicio.' }]);
    if (inicio < hoyEcuador()) throw reglaV2('VALIDATION_FAILED', 'fechaInicio no puede estar en el pasado (hora de Guayaquil).', [{ name: 'fechaInicio', reason: 'fecha pasada' }]);
    if (n > 30) throw reglaV2('VALIDATION_FAILED', 'La estancia máxima del contrato es de 30 noches.', [{ name: 'fechaFin', reason: 'más de 30 noches' }]);

    const destino = (b.destino as string).trim();
    const habitaciones = (b.habitaciones as number | undefined) ?? 1;
    const huespedes = (b.adultos as number) + ((b.ninos as number | undefined) ?? 0);
    const precioMaxC = b.precioMaximo ? aCentavos(b.precioMaximo as string) : undefined;
    const deseadas = ((b.amenidadesDeseadas as string[] | undefined) ?? []).map((a) => a.toLowerCase());

    // Este nodo aún no acepta combos: con permitePaquete=true no hay resultados.
    const filas = b.permitePaquete === true ? [] : await this.db.query<{
      alojamiento_id: string;
      unidad_id: string;
      codigo: number;
      nombre: string;
      tipo: string;
      destino: string;
      direccion: string;
      estrellas: number;
      calificacion: string | null;
      num_resenas: number;
      hora_checkin: string;
      hora_checkout: string;
      actualizado: string;
      fotos: string[] | null;
      amenidades: string[] | null;
    }>(
      `SELECT a.id::text AS alojamiento_id, u.id::text AS unidad_id, a.codigo, a.nombre, ta.nombre AS tipo, c.nombre AS destino, a.direccion,
              COALESCE(a.categoria_estrellas, 1)::int AS estrellas, r.calificacion::text AS calificacion, r.num_resenas::int AS num_resenas,
              a.hora_checkin::text AS hora_checkin, a.hora_checkout::text AS hora_checkout, ${TS('a.updated_at')} AS actualizado,
              (SELECT array_agg(i.url ORDER BY i.es_portada DESC, i.orden) FROM imagen_alojamiento i WHERE i.alojamiento_id = a.id) AS fotos,
              (SELECT array_agg(am.nombre ORDER BY am.nombre) FROM alojamiento_amenidad aa JOIN amenidad am ON am.id = aa.amenidad_id
                WHERE aa.alojamiento_id = a.id) AS amenidades
         FROM alojamiento a
         JOIN v_alojamiento_resumen r ON r.id = a.id
         JOIN tipo_alojamiento ta ON ta.id = a.tipo_id
         JOIN ciudad c ON c.id = a.ciudad_id
         JOIN LATERAL (
              SELECT x.id FROM unidad_alojamiento x
               WHERE x.alojamiento_id = a.id AND x.activa AND x.capacidad_huespedes * $2::int >= $3::int
                 AND fn_cupo_unidad(x.id, $4::date, $5::date) >= $2::int
               ORDER BY x.precio_noche_base, x.codigo_tipo LIMIT 1) u ON true
        WHERE a.estado = 'PUBLICADO' AND c.nombre ILIKE $1 AND $6::int BETWEEN a.noches_min AND a.noches_max
          AND ($7::int IS NULL OR a.categoria_estrellas >= $7::int)
        ORDER BY a.codigo`,
      [destino, habitaciones, huespedes, inicio, fin, n, (b.estrellasMinimas as number | undefined) ?? null],
    );

    const tarjetas: Record<string, unknown>[] = [];
    for (const f of filas) {
      const nombresAm = (f.amenidades ?? []).map((a) => a.toLowerCase());
      if (deseadas.some((d) => !nombresAm.includes(d))) continue;
      const precio = await this.calcularPrecio(f.unidad_id, f.alojamiento_id, inicio, fin, habitaciones);
      if (precioMaxC !== undefined && precio.precioNocheC > precioMaxC) continue;
      tarjetas.push({
        id: `HTL-${f.codigo}`,
        nombre: f.nombre,
        ...(tipoPropiedad(f.tipo) ? { tipoPropiedad: tipoPropiedad(f.tipo) } : {}),
        destino: f.destino,
        direccion: f.direccion,
        estrellas: f.estrellas,
        ...(f.calificacion ? { scoreCalificacion: Number(f.calificacion) } : {}),
        totalResenas: f.num_resenas,
        precioPorNoche: aMoney(precio.precioNocheC),
        precioTotalEstancia: aMoney(precio.totalC),
        moneda: 'USD',
        permitePaquete: false,
        descuentoMaximo: 0,
        checkInPermitidoDesde: f.hora_checkin.slice(0, 5),
        checkOutHoraMaxima: f.hora_checkout.slice(0, 5),
        fotos: f.fotos ?? [],
        amenidades: f.amenidades ?? [],
        actualizadoEn: f.actualizado,
      });
    }
    const total = tarjetas.length;
    const totalPaginas = Math.max(1, Math.ceil(total / limite));
    const data = tarjetas.slice((pagina - 1) * limite, pagina * limite);
    return {
      request_id: requestId,
      metadata: { total_results: total, page: pagina, limit: limite, total_pages: totalPaginas, has_next: pagina < totalPaginas, destino, noches: n },
      data,
      alojamientos: data,
      _links: { self: { href: `${this.base}/search?page=${pagina}&limit=${limite}`, method: 'POST' } },
    };
  }

  // =========================================================================
  // GET /alojamientos/orders  (recuperación tras timeout: saga_id, idempotency_key, external_order_id)
  // =========================================================================
  async listarOrdenes(q: Record<string, string | undefined>, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    const pagina = q.page === undefined ? 1 : Number(q.page);
    const limite = q.limit === undefined ? 10 : Number(q.limit);
    if (!entero(pagina, 1, 1_000_000)) errores.push({ name: 'page', reason: 'entero ≥ 1' });
    if (!entero(limite, 1, 50)) errores.push({ name: 'limit', reason: 'entero entre 1 y 50' });
    if (q.saga_id !== undefined && (q.saga_id.length < 1 || q.saga_id.length > 64)) errores.push({ name: 'saga_id', reason: 'texto de 1 a 64 caracteres' });
    if (q.idempotency_key !== undefined && !RE_UUID.test(q.idempotency_key)) errores.push({ name: 'idempotency_key', reason: 'UUID' });
    if (q.external_order_id !== undefined && !/^ORD-HTL-[A-Z0-9]{3,20}$/.test(q.external_order_id)) errores.push({ name: 'external_order_id', reason: 'formato ORD-HTL-XXXX' });
    const ESTADOS: Record<string, string> = {
      PENDING: `reserva.estado::text = 'PENDIENTE'`,
      CONFIRMED: `reserva.estado::text = 'CONFIRMADA' AND o.checkin_en IS NULL`,
      CANCELLED: `reserva.estado::text IN ('CANCELADA','RECHAZADA','EXPIRADA')`,
      CHECKED_IN: `reserva.estado::text = 'CONFIRMADA' AND o.checkin_en IS NOT NULL`,
      CHECKED_OUT: `reserva.estado::text = 'COMPLETADA'`,
    };
    if (q.estado !== undefined && !(q.estado in ESTADOS)) errores.push({ name: 'estado', reason: `uno de ${Object.keys(ESTADOS).join(', ')}` });
    for (const campo of ['creadoDesde', 'creadoHasta'] as const) {
      if (q[campo] !== undefined && Number.isNaN(Date.parse(q[campo] as string))) errores.push({ name: campo, reason: 'fecha RFC 3339' });
    }
    lanzarSiHayErrores(errores);

    const vacio = {
      metadata: { total_results: 0, page: pagina, limit: limite, total_pages: 0, has_next: false },
      data: [] as Record<string, unknown>[],
    };
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (usuario.rol !== 'ADMIN') where.push(`reserva.huesped_id = ${p(usuario.sub)}::uuid`); // cada cliente ve solo lo suyo
    if (q.saga_id) where.push(`o.saga_id = ${p(q.saga_id)}`);
    if (q.external_order_id) where.push(`reserva.codigo = ${p(`BK-${q.external_order_id.slice(8)}`)}`);
    if (q.idempotency_key) {
      const previa = await this.db.uno<{ ext: string | null }>(
        `SELECT respuesta->>'external_order_id' AS ext FROM idempotencia WHERE propietario = $1 AND clave = $2 AND operacion = 'orders.create.v2'`,
        [usuario.sub, q.idempotency_key],
      );
      if (!previa?.ext) return vacio;
      where.push(`reserva.codigo = ${p(`BK-${previa.ext.slice(8)}`)}`);
    }
    if (q.estado) where.push(ESTADOS[q.estado]);
    if (q.creadoDesde) where.push(`reserva.created_at >= ${p(new Date(q.creadoDesde))}`);
    if (q.creadoHasta) where.push(`reserva.created_at <= ${p(new Date(q.creadoHasta))}`);
    const desde = `FROM reserva JOIN orden_v2 o ON o.reserva_id = reserva.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

    const total = (await this.db.uno<{ n: number }>(`SELECT count(*)::int AS n ${desde}`, params))?.n ?? 0;
    const ids = await this.db.query<{ id: string }>(
      `SELECT reserva.id::text AS id ${desde} ORDER BY reserva.created_at DESC, reserva.id LIMIT ${p(limite)} OFFSET ${p((pagina - 1) * limite)}`,
      params,
    );
    const data: Record<string, unknown>[] = [];
    for (const f of ids) data.push(await this.detalleOrden('reserva.id = $1::uuid', [f.id]));
    const totalPaginas = Math.ceil(total / limite);
    return { metadata: { total_results: total, page: pagina, limit: limite, total_pages: totalPaginas, has_next: pagina < totalPaginas }, data };
  }

  // =========================================================================
  // Check-in digital / early check-in / check-out  (CHECKED_IN se deduce de orden_v2.checkin_en)
  // =========================================================================
  /** Carga la orden con bloqueo y valida que el token sea el titular (o un ADMIN). */
  private async ordenParaCambio(
    q: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
    ref: string,
    usuario: UsuarioToken,
  ): Promise<FilaCambio> {
    const [cond, valor] = condicionDeReferencia(ref);
    const filas = await q<FilaCambio>(
      `SELECT r.id::text AS id, r.estado::text AS estado, r.huesped_id::text AS huesped_id, r.fecha_entrada::text AS entrada,
              a.hora_checkin::text AS hora, o.early_checkin, ${TS('o.early_checkin_desde')} AS early_desde,
              ${TS('o.checkin_en')} AS checkin_en, ${TS('o.checkout_en')} AS checkout_en, o.habitacion_asignada AS habitacion,
              o.titular->>'identificacion' AS identificacion, u.nombre AS tipo_nombre
         FROM reserva r JOIN orden_v2 o ON o.reserva_id = r.id JOIN alojamiento a ON a.id = r.alojamiento_id
         JOIN unidad_alojamiento u ON u.id = o.unidad_id
        WHERE ${cond.replace(/reserva\.id/, 'r.id').replace(/reserva\.codigo/, 'r.codigo')} FOR UPDATE OF r, o`,
      [valor],
    );
    if (!filas.length) throw noEncontradoV2(`La reserva ${ref} no existe`);
    if (filas[0].huesped_id !== usuario.sub && usuario.rol !== 'ADMIN') throw new ProblemException(403, 'FORBIDDEN', 'La reserva pertenece a otro cliente');
    return filas[0];
  }

  async checkIn(ref: string, cuerpo: unknown, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['titularIdentificacion', 'horaLlegadaEstimada', 'peticionesEspeciales'], errores);
    if (typeof b.titularIdentificacion !== 'string' || !/^[A-Za-z0-9]{6,13}$/.test(b.titularIdentificacion)) errores.push({ name: 'titularIdentificacion', reason: '6 a 13 caracteres alfanuméricos' });
    if (b.horaLlegadaEstimada !== undefined && !(typeof b.horaLlegadaEstimada === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(b.horaLlegadaEstimada))) errores.push({ name: 'horaLlegadaEstimada', reason: 'HH:MM' });
    if (b.peticionesEspeciales !== undefined && (typeof b.peticionesEspeciales !== 'string' || b.peticionesEspeciales.length > 500)) errores.push({ name: 'peticionesEspeciales', reason: 'máximo 500 caracteres' });
    lanzarSiHayErrores(errores);

    return this.db.transaccion(async (q) => {
      const r = await this.ordenParaCambio(q, ref, usuario);
      if (r.checkin_en || r.estado !== 'CONFIRMADA') {
        throw new ProblemException(409, 'INVALID_STATE_TRANSITION', `El check-in exige una reserva CONFIRMED (estado actual: ${r.checkin_en ? 'CHECKED_IN' : estadoV2(r.estado)}).`);
      }
      if ((r.identificacion ?? '').toUpperCase() !== String(b.titularIdentificacion).toUpperCase()) {
        throw reglaV2('INVALID_DOCUMENT', 'titularIdentificacion no corresponde al titular de la reserva.');
      }
      const base = Date.parse(`${r.entrada}T${r.hora.slice(0, 8)}-05:00`);
      const habilitado = r.early_checkin ? (r.early_desde ? Date.parse(r.early_desde) : 0) : base;
      if (Date.now() < habilitado) {
        throw reglaV2('CHECKIN_TIME_NOT_REACHED', 'El check-in digital se habilita a partir de las 14:00 (hora de Guayaquil) del día de llegada.', undefined, { habilitadoDesde: iso5(habilitado) });
      }
      const habitacion = `${r.tipo_nombre} ${randomInt(101, 600)}`.slice(0, 100);
      const clave = String(randomInt(100000, 1000000));
      const ahora = Date.now();
      await q(`UPDATE orden_v2 SET checkin_en = now(), habitacion_asignada = $2, clave_digital = $3 WHERE reserva_id = $1`, [r.id, habitacion, clave]);
      await q(`SELECT fn_emitir_evento('CheckInCompletado', 'Reserva', $1::uuid, $1::uuid, jsonb_build_object('reservaId', $1::text, 'estado', 'CHECKED_IN'))`, [r.id]);
      logJson('info', 'orden_v2_checkin', { order_id: r.id });
      return {
        reservaId: r.id,
        estado: 'CHECKED_IN',
        habitacionAsignada: habitacion,
        claveAccesoDigital: clave,
        checkInHora: iso5(ahora),
        instruccionesAcceso: 'Use la clave digital en la puerta de la habitación asignada.',
        _links: {
          self: { href: `${this.base}/orders/${r.id}`, method: 'GET' },
          checkout: { href: `${this.base}/orders/${r.id}/checkout`, method: 'POST' },
        },
      };
    });
  }

  async earlyCheckin(ref: string, cuerpo: unknown, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['autorizado', 'habilitadoDesde', 'motivo'], errores);
    if (typeof b.autorizado !== 'boolean') errores.push({ name: 'autorizado', reason: 'booleano obligatorio' });
    if (b.habilitadoDesde !== undefined && (typeof b.habilitadoDesde !== 'string' || Number.isNaN(Date.parse(b.habilitadoDesde)))) errores.push({ name: 'habilitadoDesde', reason: 'fecha-hora RFC 3339' });
    if (b.motivo !== undefined && (typeof b.motivo !== 'string' || b.motivo.length > 200)) errores.push({ name: 'motivo', reason: 'máximo 200 caracteres' });
    lanzarSiHayErrores(errores);

    const id = await this.db.transaccion(async (q) => {
      const r = await this.ordenParaCambio(q, ref, usuario);
      if (r.checkin_en || r.estado !== 'CONFIRMADA') throw new ProblemException(409, 'INVALID_STATE_TRANSITION', 'El early check-in solo se autoriza en reservas CONFIRMED sin check-in.');
      const autorizado = b.autorizado as boolean;
      await q(`UPDATE orden_v2 SET early_checkin = $2, early_checkin_desde = $3 WHERE reserva_id = $1`, [r.id, autorizado, autorizado && b.habilitadoDesde ? new Date(b.habilitadoDesde as string) : null]);
      return r.id;
    });
    return this.detalleOrden('reserva.id = $1::uuid', [id]);
  }

  async checkOut(ref: string, cuerpo: unknown, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const b = cuerpo === undefined || cuerpo === null || (typeof cuerpo === 'object' && Object.keys(cuerpo as object).length === 0) ? {} : soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['consumosMinibar', 'metodoPagoConsumos'], errores);
    let consumosC = 0;
    const consumos: { item: string; cantidad: number; precio: string }[] = [];
    if (b.consumosMinibar !== undefined) {
      if (!Array.isArray(b.consumosMinibar) || b.consumosMinibar.length > 50) errores.push({ name: 'consumosMinibar', reason: 'lista de hasta 50 consumos' });
      else {
        (b.consumosMinibar as unknown[]).forEach((c, i) => {
          const x = (c ?? {}) as Record<string, unknown>;
          const cantidad = x.cantidad === undefined ? 1 : x.cantidad;
          if (typeof x.item !== 'string' || !x.item || x.item.length > 80) errores.push({ name: `consumosMinibar[${i}].item`, reason: 'texto de 1 a 80 caracteres' });
          else if (!entero(cantidad, 1, 100)) errores.push({ name: `consumosMinibar[${i}].cantidad`, reason: 'entero entre 1 y 100' });
          else if (typeof x.precio !== 'string' || !RE_MONEY.test(x.precio)) errores.push({ name: `consumosMinibar[${i}].precio`, reason: 'importe Money, p. ej. "3.50"' });
          else {
            consumosC += (cantidad as number) * aCentavos(x.precio);
            consumos.push({ item: x.item, cantidad: cantidad as number, precio: x.precio });
          }
        });
      }
    }
    if (b.metodoPagoConsumos !== undefined && !['TARJETA_REGISTRADA', 'EFECTIVO', 'CARGO_A_RESERVA'].includes(String(b.metodoPagoConsumos))) {
      errores.push({ name: 'metodoPagoConsumos', reason: 'TARJETA_REGISTRADA, EFECTIVO o CARGO_A_RESERVA' });
    }
    lanzarSiHayErrores(errores);

    return this.db.transaccion(async (q) => {
      const r = await this.ordenParaCambio(q, ref, usuario);
      if (!r.checkin_en || r.checkout_en || r.estado !== 'CONFIRMADA') {
        throw new ProblemException(409, 'INVALID_STATE_TRANSITION', 'El check-out exige una reserva CHECKED_IN.');
      }
      await q(`UPDATE orden_v2 SET checkout_en = now(), consumos = $2::jsonb, consumos_total = $3, clave_digital = NULL WHERE reserva_id = $1`, [r.id, JSON.stringify(consumos), aMoney(consumosC)]);
      await q(`UPDATE reserva SET estado = 'COMPLETADA' WHERE id = $1`, [r.id]); // dispara EstanciaCompletada (= checkout.completado)
      logJson('info', 'orden_v2_checkout', { order_id: r.id });
      return {
        orderId: r.id,
        estado: 'CHECKED_OUT',
        habitacionLiberada: r.habitacion ?? r.tipo_nombre,
        checkOutHora: iso5(Date.now()),
        consumosAdicionales: aMoney(consumosC),
        claveDigitalRevocada: true,
        _links: { self: { href: `${this.base}/orders/${r.id}`, method: 'GET' } },
      };
    });
  }

  // =========================================================================
  // GET /alojamientos/reservations  (mis reservas del canal v2)
  // =========================================================================
  async misReservas(q: Record<string, string | undefined>, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    const pagina = q.page === undefined ? 1 : Number(q.page);
    const limite = q.limit === undefined ? 10 : Number(q.limit);
    if (!entero(pagina, 1, 1_000_000)) errores.push({ name: 'page', reason: 'entero ≥ 1' });
    if (!entero(limite, 1, 50)) errores.push({ name: 'limit', reason: 'entero entre 1 y 50' });
    lanzarSiHayErrores(errores);
    const total = (await this.db.uno<{ n: number }>(`SELECT count(*)::int AS n FROM reserva JOIN orden_v2 o ON o.reserva_id = reserva.id WHERE reserva.huesped_id = $1::uuid`, [usuario.sub]))?.n ?? 0;
    const ids = await this.db.query<{ id: string }>(
      `SELECT reserva.id::text AS id FROM reserva JOIN orden_v2 o ON o.reserva_id = reserva.id WHERE reserva.huesped_id = $1::uuid
        ORDER BY reserva.created_at DESC, reserva.id LIMIT $2 OFFSET $3`,
      [usuario.sub, limite, (pagina - 1) * limite],
    );
    const data: Record<string, unknown>[] = [];
    for (const f of ids) {
      const d = await this.detalleOrden('reserva.id = $1::uuid', [f.id]);
      const oc = (d.ocupantes ?? {}) as { adultos?: number; ninos?: number };
      data.push({
        id: d.orderId,
        reservation_code: d.codigoReserva,
        external_order_id: d.external_order_id,
        accommodation_id: d.alojamientoId,
        accommodation_name: d.alojamientoNombre,
        room_type: d.tipoHabitacionCodigo,
        checkin: d.checkinFecha,
        checkout: d.checkoutFecha,
        number_of_rooms: d.cantidadHabitaciones,
        guests: { adults: oc.adultos ?? 0, children: oc.ninos ?? 0 },
        total_price: d.total,
        currency: 'USD',
        status: d.estado,
        created_at: d.createdAt,
      });
    }
    const totalPaginas = Math.ceil(total / limite);
    return { metadata: { total_results: total, page: pagina, limit: limite, total_pages: totalPaginas, has_next: pagina < totalPaginas }, data };
  }

  // =========================================================================
  // Catálogo de lectura: categorías, ficha, habitaciones, disponibilidad indicativa
  // =========================================================================
  private async alojamientoPublicado(idPublico: string): Promise<{ id: string; codigo: number }> {
    const m = /^HTL-(\d{1,9})$/i.exec(idPublico);
    const f =
      m || RE_UUID.test(idPublico)
        ? await this.db.uno<{ id: string; codigo: number }>(`SELECT id::text AS id, codigo FROM alojamiento WHERE estado = 'PUBLICADO' AND ${m ? 'codigo = $1' : 'id = $1::uuid'}`, [m ? Number(m[1]) : idPublico])
        : null;
    if (!f) throw new ProblemException(404, 'HOTEL_NOT_FOUND', `El alojamiento ${idPublico} no existe o no está publicado`);
    return f;
  }

  async categorias(): Promise<Record<string, unknown>[]> {
    const filas = await this.db.query<{ id: number; nombre: string }>(`SELECT id::int AS id, nombre FROM tipo_alojamiento ORDER BY nombre`);
    return filas.map((f, i) => ({
      id: `CAT-${f.id}`,
      nombre: f.nombre,
      slug: (f.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `tipo-${f.id}`).padEnd(2, 'x'),
      orden: i,
    }));
  }

  async detalleAlojamiento(idPublico: string): Promise<Record<string, unknown>> {
    const a0 = await this.alojamientoPublicado(idPublico);
    const f = await this.db.uno<{
      codigo: number; nombre: string; descripcion: string; direccion: string; lat: number; lng: number; estrellas: number; politica_id: number;
      hora_checkin: string; hora_checkout: string; tipo: string; destino: string; calificacion: string | null; actualizado: string;
      fotos: string[] | null; amenidades: string[] | null; proveedor: string;
    }>(
      `SELECT a.codigo, a.nombre, a.descripcion, a.direccion, a.latitud::float8 AS lat, a.longitud::float8 AS lng,
              COALESCE(a.categoria_estrellas, 1)::int AS estrellas, a.politica_id::int AS politica_id,
              a.hora_checkin::text AS hora_checkin, a.hora_checkout::text AS hora_checkout, ta.nombre AS tipo, c.nombre AS destino,
              r.calificacion::text AS calificacion, ${TS('a.updated_at')} AS actualizado,
              (SELECT array_agg(i.url ORDER BY i.es_portada DESC, i.orden) FROM imagen_alojamiento i WHERE i.alojamiento_id = a.id) AS fotos,
              (SELECT array_agg(am.nombre ORDER BY am.nombre) FROM alojamiento_amenidad aa JOIN amenidad am ON am.id = aa.amenidad_id WHERE aa.alojamiento_id = a.id) AS amenidades,
              (u.nombres || ' ' || u.apellidos) AS proveedor
         FROM alojamiento a
         JOIN v_alojamiento_resumen r ON r.id = a.id
         JOIN tipo_alojamiento ta ON ta.id = a.tipo_id
         JOIN ciudad c ON c.id = a.ciudad_id
         JOIN usuario u ON u.id = a.anfitrion_id
        WHERE a.id = $1::uuid`,
      [a0.id],
    );
    if (!f) throw new ProblemException(404, 'HOTEL_NOT_FOUND', `El alojamiento ${idPublico} no existe`);
    return {
      id: `HTL-${f.codigo}`,
      nombre: f.nombre,
      ...(tipoPropiedad(f.tipo) ? { tipoPropiedad: tipoPropiedad(f.tipo) } : {}),
      descripcion: f.descripcion.slice(0, 2000),
      destino: f.destino,
      direccion: f.direccion,
      coordenadasGps: { latitud: f.lat, longitud: f.lng },
      zonaHoraria: 'America/Guayaquil',
      estrellas: f.estrellas,
      ...(f.calificacion ? { scoreCalificacion: Number(f.calificacion) } : {}),
      politicaCancelacion: await this.politica(f.politica_id),
      checkInPermitidoDesde: f.hora_checkin.slice(0, 5),
      checkOutHoraMaxima: f.hora_checkout.slice(0, 5),
      amenidades: f.amenidades ?? [],
      galeriaFotos: f.fotos ?? [],
      permitePaquete: false,
      descuentoMaximo: 0,
      proveedor: { id: 'MS_ALOJAMIENTOS', nombre: f.proveedor.slice(0, 120) },
      actualizadoEn: f.actualizado,
      _links: {
        self: { href: `${this.base}/HTL-${f.codigo}`, method: 'GET' },
        habitaciones: { href: `${this.base}/HTL-${f.codigo}/habitaciones`, method: 'GET' },
        availability: { href: `${this.base}/HTL-${f.codigo}/availability`, method: 'GET' },
      },
    };
  }

  async habitaciones(idPublico: string): Promise<Record<string, unknown>> {
    const a0 = await this.alojamientoPublicado(idPublico);
    const nombre = (await this.db.uno<{ nombre: string }>(`SELECT nombre FROM alojamiento WHERE id = $1::uuid`, [a0.id]))?.nombre ?? '';
    const hoy = hoyEcuador();
    const manana = new Date(Date.parse(hoy) + 86_400_000).toISOString().slice(0, 10);
    const filas = await this.db.query<{ codigo_tipo: string; nombre: string; capacidad: number; camas: number; precio: string; total: number; libres: number }>(
      `SELECT u.codigo_tipo, u.nombre, u.capacidad_huespedes::int AS capacidad, u.num_camas::int AS camas, u.precio_noche_base::text AS precio,
              u.cantidad::int AS total, fn_cupo_unidad(u.id, $2::date, $3::date)::int AS libres
         FROM unidad_alojamiento u WHERE u.alojamiento_id = $1::uuid AND u.activa ORDER BY u.precio_noche_base, u.codigo_tipo`,
      [a0.id, hoy, manana],
    );
    return {
      alojamientoId: `HTL-${a0.codigo}`,
      alojamientoNombre: nombre,
      habitaciones: filas.map((f) => ({
        codigo: f.codigo_tipo,
        nombre: f.nombre,
        capacidadAdultos: f.capacidad,
        capacidadNinos: 0,
        camas: `${f.camas} cama${f.camas === 1 ? '' : 's'}`,
        regimen: 'SOLO_HABITACION',
        precioBaseNoche: aMoney(aCentavos(f.precio)),
        habitacionesTotales: f.total,
        habitacionesDisponibles: Math.max(0, f.libres),
      })),
    };
  }

  async disponibilidadIndicativa(idPublico: string, q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const a0 = await this.alojamientoPublicado(idPublico);
    const errores: InvalidParam[] = [];
    if (!esFechaReal(q.checkin)) errores.push({ name: 'checkin', reason: 'fecha AAAA-MM-DD obligatoria' });
    if (!esFechaReal(q.checkout)) errores.push({ name: 'checkout', reason: 'fecha AAAA-MM-DD obligatoria' });
    if (q.tipoHabitacion !== undefined && !RE_TIPO.test(q.tipoHabitacion)) errores.push({ name: 'tipoHabitacion', reason: 'código en mayúsculas, p. ej. SUITE_DELUXE' });
    const adultos = q.adults === undefined ? 1 : Number(q.adults);
    const ninos = q.children === undefined ? 0 : Number(q.children);
    const cuartos = q.rooms === undefined ? 1 : Number(q.rooms);
    if (!entero(adultos, 1, 20)) errores.push({ name: 'adults', reason: 'entero entre 1 y 20' });
    if (!entero(ninos, 0, 10)) errores.push({ name: 'children', reason: 'entero entre 0 y 10' });
    if (!entero(cuartos, 1, 10)) errores.push({ name: 'rooms', reason: 'entero entre 1 y 10' });
    lanzarSiHayErrores(errores);
    const entrada = q.checkin as string;
    const salida = q.checkout as string;
    const n = contarNoches(entrada, salida);
    if (n <= 0) throw reglaV2('VALIDATION_FAILED', 'checkout debe ser posterior a checkin.', [{ name: 'checkout', reason: 'Debe ser estrictamente posterior a checkin.' }]);
    if (entrada < hoyEcuador()) throw reglaV2('VALIDATION_FAILED', 'checkin no puede estar en el pasado (hora de Guayaquil).', [{ name: 'checkin', reason: 'fecha pasada' }]);
    if (n > 30) throw reglaV2('VALIDATION_FAILED', 'La estancia máxima del contrato es de 30 noches.', [{ name: 'checkout', reason: 'más de 30 noches' }]);
    const reglas = await this.db.uno<{ min: number; max: number }>(`SELECT noches_min::int AS min, noches_max::int AS max FROM alojamiento WHERE id = $1::uuid`, [a0.id]);
    if (reglas && n < reglas.min) throw reglaV2('RESTRICTION_VIOLATED', `La propiedad exige una estancia mínima de ${reglas.min} noche(s).`, undefined, { restriccion: 'MIN_STAY' });
    if (reglas && n > reglas.max) throw reglaV2('RESTRICTION_VIOLATED', `La propiedad admite una estancia máxima de ${reglas.max} noche(s).`, undefined, { restriccion: 'MAX_STAY' });
    const unidades = await this.db.query<{ id: string; codigo_tipo: string; nombre: string; capacidad: number; cupo: number }>(
      `SELECT u.id::text AS id, u.codigo_tipo, u.nombre, u.capacidad_huespedes::int AS capacidad, fn_cupo_unidad(u.id, $2::date, $3::date)::int AS cupo
         FROM unidad_alojamiento u WHERE u.alojamiento_id = $1::uuid AND u.activa AND ($4::text IS NULL OR u.codigo_tipo = $4)
        ORDER BY u.precio_noche_base, u.codigo_tipo`,
      [a0.id, entrada, salida, q.tipoHabitacion ?? null],
    );
    if (q.tipoHabitacion && !unidades.length) throw noEncontradoV2(`El tipo de habitación ${q.tipoHabitacion} no existe en HTL-${a0.codigo}`);
    const opciones: Record<string, unknown>[] = [];
    for (const u of unidades) {
      const precio = await this.calcularPrecio(u.id, a0.id, entrada, salida, cuartos);
      opciones.push({
        tipoHabitacionCodigo: u.codigo_tipo,
        nombre: u.nombre,
        estaDisponible: u.cupo >= cuartos && u.capacidad * cuartos >= adultos + ninos,
        habitacionesRemanentes: Math.max(0, u.cupo),
        precioNoche: aMoney(precio.precioNocheC),
        precioTotalEstancia: aMoney(precio.totalC),
        regimen: 'SOLO_HABITACION',
        planTarifaCodigo: PLAN_POR_DEFECTO,
      });
    }
    return { alojamientoId: `HTL-${a0.codigo}`, checkin: entrada, checkout: salida, noches: n, opciones };
  }

  // =========================================================================
  // Reseñas con estancia verificada
  // =========================================================================
  async resenas(idPublico: string, q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const a0 = await this.alojamientoPublicado(idPublico);
    const errores: InvalidParam[] = [];
    const pagina = q.page === undefined ? 1 : Number(q.page);
    const limite = q.limit === undefined ? 10 : Number(q.limit);
    if (!entero(pagina, 1, 1_000_000)) errores.push({ name: 'page', reason: 'entero ≥ 1' });
    if (!entero(limite, 1, 50)) errores.push({ name: 'limit', reason: 'entero entre 1 y 50' });
    lanzarSiHayErrores(errores);
    const est = await this.db.uno<{ prom: string | null; n: number }>(
      `SELECT avg(rs.nota_global)::numeric(4,1)::text AS prom, count(*)::int AS n FROM resena rs JOIN reserva r ON r.id = rs.reserva_id
        WHERE r.alojamiento_id = $1::uuid AND rs.estado = 'PUBLICADA'`,
      [a0.id],
    );
    const filas = await this.db.query<{ id: string; autor: string; nota: number; fecha: string; comentario: string | null; habitacion: string | null }>(
      `SELECT rs.id::text AS id, (split_part(u.nombres, ' ', 1) || ' ' || left(u.apellidos, 1) || '.') AS autor, rs.nota_global::int AS nota,
              to_char(rs.created_at AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha, rs.comentario,
              (SELECT un.nombre FROM reserva_detalle d JOIN unidad_alojamiento un ON un.id = d.unidad_id WHERE d.reserva_id = r.id LIMIT 1) AS habitacion
         FROM resena rs JOIN reserva r ON r.id = rs.reserva_id JOIN usuario u ON u.id = r.huesped_id
        WHERE r.alojamiento_id = $1::uuid AND rs.estado = 'PUBLICADA'
        ORDER BY rs.created_at DESC, rs.id LIMIT $2 OFFSET $3`,
      [a0.id, limite, (pagina - 1) * limite],
    );
    const total = est?.n ?? 0;
    const totalPaginas = Math.ceil(total / limite);
    return {
      alojamientoId: `HTL-${a0.codigo}`,
      scorePromedio: est?.prom ? Number(est.prom) : 0,
      totalResenas: total,
      metadata: { total_results: total, page: pagina, limit: limite, total_pages: totalPaginas, has_next: pagina < totalPaginas },
      resenas: filas.map((f) => ({
        id: f.id,
        autorNombre: f.autor,
        calificacionGlobal: f.nota,
        fecha: f.fecha,
        comentario: (f.comentario && f.comentario.trim() ? f.comentario : 'Sin comentario del huésped.').padEnd(10, '.'),
        estadiaVerificada: true,
        ...(f.habitacion ? { tipoHabitacionAlojado: f.habitacion } : {}),
      })),
    };
  }

  async crearResena(idPublico: string, cuerpo: unknown, usuario: UsuarioToken): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['reservaId', 'calificacionGlobal', 'desgloseCalificaciones', 'comentario', 'tipoViaje'], errores);
    if (typeof b.reservaId !== 'string') errores.push({ name: 'reservaId', reason: 'UUID, ORD-HTL-… o BK-HOTEL-…' });
    if (typeof b.calificacionGlobal !== 'number' || !(b.calificacionGlobal >= 1 && b.calificacionGlobal <= 10)) errores.push({ name: 'calificacionGlobal', reason: 'número entre 1 y 10' });
    if (typeof b.comentario !== 'string' || b.comentario.length < 10 || b.comentario.length > 2000) errores.push({ name: 'comentario', reason: 'texto de 10 a 2000 caracteres' });
    if (b.tipoViaje !== undefined && !['SOLO', 'PAREJA', 'FAMILIA', 'NEGOCIOS', 'GRUPO'].includes(String(b.tipoViaje))) errores.push({ name: 'tipoViaje', reason: 'SOLO, PAREJA, FAMILIA, NEGOCIOS o GRUPO' });
    if (b.desgloseCalificaciones !== undefined) {
      const dg = b.desgloseCalificaciones as Record<string, unknown>;
      if (typeof dg !== 'object' || dg === null || Array.isArray(dg)) errores.push({ name: 'desgloseCalificaciones', reason: 'objeto' });
      else {
        for (const [k, v] of Object.entries(dg)) {
          if (!['limpieza', 'confort', 'ubicacion', 'personal', 'relacionCalidadPrecio'].includes(k) || typeof v !== 'number' || v < 0 || v > 10) {
            errores.push({ name: `desgloseCalificaciones.${k}`, reason: 'nota numérica entre 0 y 10' });
          }
        }
      }
    }
    lanzarSiHayErrores(errores);
    const a0 = await this.alojamientoPublicado(idPublico);
    const [cond, valor] = condicionDeReferencia(b.reservaId as string);
    const r = await this.db.uno<{ id: string; estado: string; huesped_id: string; alojamiento_id: string; autor: string; habitacion: string | null }>(
      `SELECT reserva.id::text AS id, reserva.estado::text AS estado, reserva.huesped_id::text AS huesped_id, reserva.alojamiento_id::text AS alojamiento_id,
              (split_part(u.nombres, ' ', 1) || ' ' || left(u.apellidos, 1) || '.') AS autor, un.nombre AS habitacion
         FROM reserva JOIN orden_v2 o ON o.reserva_id = reserva.id JOIN usuario u ON u.id = reserva.huesped_id JOIN unidad_alojamiento un ON un.id = o.unidad_id
        WHERE ${cond}`,
      [valor],
    );
    if (!r || r.alojamiento_id !== a0.id) throw noEncontradoV2('La reserva no existe en este alojamiento');
    if (r.huesped_id !== usuario.sub && usuario.rol !== 'ADMIN') throw new ProblemException(403, 'FORBIDDEN', 'La reserva pertenece a otro cliente');
    if (r.estado !== 'COMPLETADA') throw new ProblemException(409, 'INVALID_STATE_TRANSITION', 'Solo se puede reseñar una reserva en estado CHECKED_OUT.');
    const previa = await this.db.uno<{ id: string }>(`SELECT id::text AS id FROM resena WHERE reserva_id = $1::uuid`, [r.id]);
    if (previa) throw new ProblemException(409, 'CONFLICT', 'Esta reserva ya tiene una reseña.');
    const nueva = await this.db.uno<{ id: string; fecha: string }>(
      `INSERT INTO resena (reserva_id, nota_global, comentario) VALUES ($1::uuid, round($2::numeric)::int, $3)
       RETURNING id::text AS id, to_char(created_at AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD') AS fecha`,
      [r.id, b.calificacionGlobal, b.comentario],
    );
    return {
      id: nueva?.id,
      autorNombre: r.autor,
      calificacionGlobal: b.calificacionGlobal,
      ...(b.desgloseCalificaciones ? { desgloseCalificaciones: b.desgloseCalificaciones } : {}),
      fecha: nueva?.fecha,
      comentario: b.comentario,
      ...(b.tipoViaje ? { tipoViaje: b.tipoViaje } : {}),
      estadiaVerificada: true,
      ...(r.habitacion ? { tipoHabitacionAlojado: r.habitacion } : {}),
    };
  }

  // =========================================================================
  // GET /alojamientos/eventos  (Transactional Outbox como CloudEvents, orden estricto por sequence)
  // =========================================================================
  async eventos(q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    const despues = q.after === undefined ? 0 : Number(q.after);
    const limite = q.limit === undefined ? 50 : Number(q.limit);
    if (!Number.isInteger(despues) || despues < 0) errores.push({ name: 'after', reason: 'entero ≥ 0' });
    if (!entero(limite, 1, 200)) errores.push({ name: 'limit', reason: 'entero entre 1 y 200' });
    const TIPOS = ['alojamiento.reserva.confirmada', 'alojamiento.reserva.cancelada', 'alojamiento.checkin.completado', 'alojamiento.checkout.completado', 'alojamiento.stock.actualizado'];
    if (q.type !== undefined && !TIPOS.includes(q.type)) errores.push({ name: 'type', reason: `uno de ${TIPOS.join(', ')}` });
    lanzarSiHayErrores(errores);
    // sequence = posición estable en el feed de eventos del canal v2 (sin saltos: solo se agregan al final)
    const filas = await this.db.query<{ seq: string; ce_tipo: string; tiempo: string; correlacion: string; orden_id: string; codigo: string; saga_id: string | null; alojamiento: number; total: string }>(
      `WITH ev AS (
         SELECT e.id, e.created_at, e.agregado_id, e.correlacion_id,
                CASE WHEN e.tipo = 'ReservaConfirmada' OR (e.tipo = 'ReservaCreada' AND e.payload->>'estado' = 'CONFIRMADA') THEN 'alojamiento.reserva.confirmada'
                     WHEN e.tipo = 'ReservaCancelada'   THEN 'alojamiento.reserva.cancelada'
                     WHEN e.tipo = 'CheckInCompletado'  THEN 'alojamiento.checkin.completado'
                     WHEN e.tipo = 'EstanciaCompletada' THEN 'alojamiento.checkout.completado' END AS ce_tipo
           FROM evento_outbox e WHERE e.agregado = 'Reserva'),
       num AS (
         SELECT ev.*, row_number() OVER (ORDER BY ev.id) AS seq FROM ev
          WHERE ev.ce_tipo IS NOT NULL AND EXISTS (SELECT 1 FROM orden_v2 o WHERE o.reserva_id = ev.agregado_id))
       SELECT num.seq::text AS seq, num.ce_tipo, ${TS('num.created_at')} AS tiempo, num.correlacion_id::text AS correlacion, r.id::text AS orden_id, r.codigo,
              o.saga_id, a.codigo AS alojamiento, o.total::text AS total
         FROM num JOIN reserva r ON r.id = num.agregado_id JOIN orden_v2 o ON o.reserva_id = r.id JOIN alojamiento a ON a.id = r.alojamiento_id
        WHERE num.seq > $1 AND ($2::text IS NULL OR num.ce_tipo = $2) ORDER BY num.seq LIMIT $3`,
      [despues, q.type ?? null, limite + 1],
    );
    const hayMas = filas.length > limite;
    const visibles = filas.slice(0, limite);
    const estados: Record<string, string> = {
      'alojamiento.reserva.confirmada': 'CONFIRMED',
      'alojamiento.reserva.cancelada': 'CANCELLED',
      'alojamiento.checkin.completado': 'CHECKED_IN',
      'alojamiento.checkout.completado': 'CHECKED_OUT',
    };
    const eventos = visibles.map((f) => ({
      id: `evt-alo-${f.seq}`,
      source: this.base,
      specversion: '1.0',
      type: f.ce_tipo,
      time: f.tiempo,
      sequence: Number(f.seq),
      subject: `orders/ORD-HTL-${f.codigo.slice(3)}`,
      correlationid: f.correlacion,
      datacontenttype: 'application/json',
      data: {
        orderId: f.orden_id,
        external_order_id: `ORD-HTL-${f.codigo.slice(3)}`,
        ...(f.saga_id ? { saga_id: f.saga_id } : {}),
        estado: estados[f.ce_tipo],
        alojamientoId: `HTL-${f.alojamiento}`,
        total: aMoney(aCentavos(f.total)),
      },
    }));
    return { eventos, has_more: hayMas, next_after: eventos.length ? eventos[eventos.length - 1].sequence : despues };
  }

  // =========================================================================
  // Acuerdo B2B de promociones (GET / PUT solo ADMIN)
  // =========================================================================
  private async contratoPromociones(): Promise<Record<string, unknown>> {
    const f = await this.db.uno<{ permite: boolean; pct: string; destinos: string[]; desde: string; hasta: string | null; condiciones: string | null; contacto: unknown; actualizado: string }>(
      `SELECT permite_promociones AS permite, porcentaje_descuento_maximo::text AS pct, destinos_habilitados AS destinos, vigencia_desde::text AS desde,
              vigencia_hasta::text AS hasta, condiciones_combo AS condiciones, contacto_comercial AS contacto, ${TS('updated_at')} AS actualizado
         FROM contrato_promociones WHERE id = 1`,
    );
    if (!f) throw new ProblemException(500, 'INTERNAL_ERROR', 'El acuerdo de promociones no está inicializado (ejecuta database/05_v2_checkin.sql)');
    return {
      tienda_id: process.env.STOCK_SERVICE_ID || 'alojamientos',
      vertical: 'alojamientos',
      permite_promociones: f.permite,
      porcentaje_descuento_maximo: Number(f.pct),
      destinos_habilitados: f.destinos,
      vigencia_desde: f.desde,
      ...(f.hasta ? { vigencia_hasta: f.hasta } : {}),
      ...(f.condiciones ? { condiciones_combo: f.condiciones } : {}),
      ...(f.contacto ? { contacto_comercial: f.contacto } : {}),
      updated_at: f.actualizado,
    };
  }

  obtenerContratoPromociones(): Promise<Record<string, unknown>> {
    return this.contratoPromociones();
  }

  async guardarContratoPromociones(cuerpo: unknown): Promise<Record<string, unknown>> {
    const b = soloObjeto(cuerpo);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['permite_promociones', 'porcentaje_descuento_maximo', 'destinos_habilitados', 'vigencia_hasta', 'condiciones_combo', 'contacto_comercial'], errores);
    if (typeof b.permite_promociones !== 'boolean') errores.push({ name: 'permite_promociones', reason: 'booleano obligatorio' });
    if (typeof b.porcentaje_descuento_maximo !== 'number' || !(b.porcentaje_descuento_maximo >= 0 && b.porcentaje_descuento_maximo <= 50)) errores.push({ name: 'porcentaje_descuento_maximo', reason: 'número entre 0 y 50' });
    if (b.destinos_habilitados !== undefined && (!Array.isArray(b.destinos_habilitados) || b.destinos_habilitados.length > 50 || b.destinos_habilitados.some((d) => typeof d !== 'string' || d.length > 80))) {
      errores.push({ name: 'destinos_habilitados', reason: 'lista de hasta 50 textos de máximo 80 caracteres' });
    }
    if (b.vigencia_hasta !== undefined && !esFechaReal(b.vigencia_hasta)) errores.push({ name: 'vigencia_hasta', reason: 'fecha AAAA-MM-DD' });
    if (b.condiciones_combo !== undefined && (typeof b.condiciones_combo !== 'string' || b.condiciones_combo.length > 500)) errores.push({ name: 'condiciones_combo', reason: 'máximo 500 caracteres' });
    if (b.contacto_comercial !== undefined) {
      const c = b.contacto_comercial as Record<string, unknown>;
      if (typeof c !== 'object' || c === null || Array.isArray(c)) errores.push({ name: 'contacto_comercial', reason: 'objeto' });
      else {
        camposDesconocidos(c, ['nombre', 'email', 'telefono'], errores);
        if (c.nombre !== undefined && (typeof c.nombre !== 'string' || c.nombre.length > 100)) errores.push({ name: 'contacto_comercial.nombre', reason: 'máximo 100 caracteres' });
        if (c.email !== undefined && (typeof c.email !== 'string' || c.email.length > 120 || !RE_EMAIL.test(c.email))) errores.push({ name: 'contacto_comercial.email', reason: 'correo válido' });
        if (c.telefono !== undefined && (typeof c.telefono !== 'string' || !RE_TELEFONO.test(c.telefono))) errores.push({ name: 'contacto_comercial.telefono', reason: '+593… o 09…' });
      }
    }
    lanzarSiHayErrores(errores);
    if (b.permite_promociones === false && b.porcentaje_descuento_maximo !== 0) {
      throw reglaV2('VALIDATION_FAILED', 'Si permite_promociones es false, porcentaje_descuento_maximo debe ser 0.', [{ name: 'porcentaje_descuento_maximo', reason: 'debe ser 0 cuando no se permiten promociones' }]);
    }
    await this.db.query(
      `UPDATE contrato_promociones SET permite_promociones = $1, porcentaje_descuento_maximo = $2, destinos_habilitados = $3::text[],
              vigencia_hasta = $4, condiciones_combo = $5, contacto_comercial = $6::jsonb, updated_at = now() WHERE id = 1`,
      [b.permite_promociones, b.porcentaje_descuento_maximo, (b.destinos_habilitados as string[] | undefined) ?? [], (b.vigencia_hasta as string | undefined) ?? null, (b.condiciones_combo as string | undefined) ?? null, b.contacto_comercial ? JSON.stringify(b.contacto_comercial) : null],
    );
    return this.contratoPromociones();
  }

  // =========================================================================
  // Piezas comunes
  // =========================================================================
  private async resolverUnidad(c: ComunV2): Promise<{ aloj: FilaAloj; unidad: FilaUnidad }> {
    const m = /^HTL-(\d{1,9})$/i.exec(c.alojamientoId);
    const porUuid = RE_UUID.test(c.alojamientoId);
    const aloj =
      m || porUuid
        ? await this.db.uno<FilaAloj>(
            `SELECT id::text AS id, codigo, nombre, politica_id::int AS politica_id, hora_checkin::text AS hora_checkin,
                    noches_min::int AS noches_min, noches_max::int AS noches_max
               FROM alojamiento WHERE estado = 'PUBLICADO' AND ${m ? 'codigo = $1' : 'id = $1::uuid'}`,
            [m ? Number(m[1]) : c.alojamientoId],
          )
        : null;
    if (!aloj) throw noEncontradoV2(`El alojamiento ${c.alojamientoId} no existe o no está publicado`);
    const unidad = await this.db.uno<FilaUnidad>(
      `SELECT id::text AS id, nombre, codigo_tipo, capacidad_huespedes::int AS capacidad_huespedes
         FROM unidad_alojamiento WHERE alojamiento_id = $1 AND codigo_tipo = $2 AND activa`,
      [aloj.id, c.tipoHabitacionCodigo],
    );
    if (!unidad) throw noEncontradoV2(`El tipo de habitación ${c.tipoHabitacionCodigo} no existe en ${c.alojamientoId}`);
    if (c.planTarifaCodigo && c.planTarifaCodigo !== PLAN_POR_DEFECTO) throw noEncontradoV2(`El plan de tarifa ${c.planTarifaCodigo} no existe (este nodo solo ofrece ${PLAN_POR_DEFECTO})`);
    return { aloj, unidad };
  }

  /** Reglas de negocio comunes (422). */
  private validarReglas(c: ComunV2, aloj: FilaAloj, unidad: FilaUnidad): void {
    if (c.currency !== 'USD') throw reglaV2('UNSUPPORTED_CURRENCY', 'Este nodo opera solo en USD.');
    if (!esFechaReal(c.fechaInicio) || !esFechaReal(c.fechaFin)) throw invalido('Fechas inválidas');
    const n = contarNoches(c.fechaInicio, c.fechaFin);
    if (n <= 0) throw reglaV2('VALIDATION_FAILED', 'fechaFin debe ser posterior a fechaInicio.', [{ name: 'fechaFin', reason: 'Debe ser estrictamente posterior a fechaInicio.' }]);
    if (c.fechaInicio < hoyEcuador()) throw reglaV2('VALIDATION_FAILED', 'fechaInicio no puede estar en el pasado (hora de Guayaquil).', [{ name: 'fechaInicio', reason: 'fecha pasada' }]);
    if (n > 30) throw reglaV2('VALIDATION_FAILED', 'La estancia máxima del contrato es de 30 noches.', [{ name: 'fechaFin', reason: 'más de 30 noches' }]);
    if (n < aloj.noches_min) throw reglaV2('RESTRICTION_VIOLATED', `La propiedad exige una estancia mínima de ${aloj.noches_min} noche(s).`, undefined, { restriccion: 'MIN_STAY' });
    if (n > aloj.noches_max) throw reglaV2('RESTRICTION_VIOLATED', `La propiedad admite una estancia máxima de ${aloj.noches_max} noche(s).`, undefined, { restriccion: 'MAX_STAY' });
    if (c.ocupantes) {
      const total = c.ocupantes.adultos + c.ocupantes.ninos;
      const cap = unidad.capacidad_huespedes * c.cantidadHabitaciones;
      if (total > cap) throw reglaV2('CAPACITY_EXCEEDED', `${unidad.codigo_tipo} admite ${unidad.capacidad_huespedes} huésped(es) por habitación (${cap} en total).`);
    }
  }

  /** Precio noche por noche en centavos enteros: subtotal + IVA + tasa municipal − combo (exacto). */
  private async calcularPrecio(unidadId: string, alojId: string, entrada: string, salida: string, cantidad: number): Promise<Precio> {
    const filas = await this.db.query<{ fecha: string; precio: string; iva: string }>(
      `SELECT n::date::text AS fecha, COALESCE(c.precio_noche, u.precio_noche_base)::text AS precio,
              COALESCE(fn_iva_pct($2, n::date), 0)::text AS iva
         FROM unidad_alojamiento u
        CROSS JOIN generate_series($3::date, $4::date - 1, interval '1 day') n
         LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
        WHERE u.id = $1 ORDER BY n`,
      [unidadId, alojId, entrada, salida],
    );
    const noches: Noche[] = filas.map((f) => ({ fecha: f.fecha, precioC: aCentavos(f.precio), ivaPct100: Math.round(Number(f.iva) * 100) }));
    const subtotalC = noches.reduce((s, n) => s + n.precioC * cantidad, 0);
    const ivaC = Math.round(noches.reduce((s, n) => s + n.precioC * cantidad * n.ivaPct100, 0) / 10000);
    const tasaC = TASA_MUNICIPAL_CENTAVOS * noches.length * cantidad;
    const descuentoC = 0;
    return {
      noches,
      cantidad,
      precioNocheC: noches[0]?.precioC ?? 0,
      subtotalC,
      ivaPct: (noches[0]?.ivaPct100 ?? 0) / 100,
      ivaC,
      tasaC,
      descuentoC,
      totalC: subtotalC + ivaC + tasaC - descuentoC,
      nochesDetalle: noches.map((n) => ({ fecha: n.fecha, precio: aMoney(n.precioC * cantidad) })),
    };
  }

  /** Política de cancelación en la forma de PoliticaCancelacionV2. */
  private async politica(politicaId: number): Promise<Record<string, unknown>> {
    const filas = await this.db.query<{ descripcion: string; horas: number | null; pct: string | null }>(
      `SELECT p.descripcion, g.horas_minimas::int AS horas, g.porcentaje_penalidad::text AS pct
         FROM politica_cancelacion p LEFT JOIN politica_cancelacion_regla g ON g.politica_id = p.id
        WHERE p.id = $1 ORDER BY g.horas_minimas DESC`,
      [politicaId],
    );
    const reglas = filas.filter((f) => f.horas !== null).map((f) => ({ horas: f.horas as number, pct: Number(f.pct) }));
    const gratis = reglas.filter((r) => r.pct === 0).map((r) => r.horas);
    const horasLimite = gratis.length ? Math.min(...gratis) : undefined;
    const masCercana = reglas.length ? reglas[reglas.length - 1] : undefined;
    return {
      esReembolsable: gratis.length > 0,
      ...(horasLimite !== undefined ? { horasLimiteCancelacion: Math.min(horasLimite, 720) } : {}),
      ...(masCercana ? { penalidadFueraDeVentanaPorcentaje: masCercana.pct } : {}),
      descripcion: (filas[0]?.descripcion ?? '').slice(0, 300),
    };
  }

  /** OrderDetailV2 completo. `condicion` usa los alias reserva.id / reserva.codigo. */
  private async detalleOrden(condicion: string, params: unknown[], usuario?: UsuarioToken): Promise<Record<string, unknown>> {
    const f = await this.db.uno<Record<string, unknown>>(
      `SELECT reserva.id::text AS id, reserva.codigo, reserva.estado::text AS estado, reserva.fecha_entrada::text AS entrada,
              reserva.fecha_salida::text AS salida, reserva.noches::int AS noches, reserva.huesped_id::text AS huesped_id,
              ${TS('reserva.created_at')} AS creada,
              a.codigo AS aloj_codigo, a.nombre AS aloj_nombre, a.hora_checkin::text AS hora_checkin, a.politica_id::int AS politica_id,
              u.nombre AS tipo_nombre, u.codigo_tipo,
              o.cotizacion_id::text AS cotizacion_id, o.cantidad::int AS cantidad, o.saga_id, o.plan_tarifa, o.regimen, o.ocupantes, o.titular,
              o.subtotal::text AS subtotal, o.iva_porcentaje::text AS iva_pct, o.iva_valor::text AS iva_valor, o.tasa_municipal::text AS tasa,
              o.descuento_combo::text AS descuento, o.total::text AS total, ${TS('o.cancelada_en')} AS cancelada_en,
              ${TS('o.checkin_en')} AS checkin_en, ${TS('o.checkout_en')} AS checkout_en, o.early_checkin, ${TS('o.early_checkin_desde')} AS early_desde,
              o.habitacion_asignada, o.clave_digital
         FROM reserva
         JOIN orden_v2 o ON o.reserva_id = reserva.id
         JOIN alojamiento a ON a.id = reserva.alojamiento_id
         JOIN unidad_alojamiento u ON u.id = o.unidad_id
        WHERE ${condicion}`,
      params,
    );
    if (!f) throw noEncontradoV2('La reserva no existe');
    if (usuario && f.huesped_id !== usuario.sub && usuario.rol !== 'ADMIN') {
      throw new ProblemException(403, 'FORBIDDEN', 'La reserva pertenece a otro cliente');
    }
    const sufijo = String(f.codigo).slice(3);
    let estado = estadoV2(String(f.estado));
    if (estado === 'CONFIRMED' && f.checkin_en) estado = 'CHECKED_IN';
    const hora = String(f.hora_checkin);
    const habilitado = f.early_checkin && f.early_desde ? String(f.early_desde) : `${String(f.entrada)}T${hora.slice(0, 8)}-05:00`;
    const pol = (await this.politica(Number(f.politica_id))) as { esReembolsable: boolean; horasLimiteCancelacion?: number; descripcion: string };
    const ivaPct = Number(f.iva_pct);
    const impuestos = [
      { codigo: 'IVA', nombre: `IVA ${ivaPct} %`, porcentaje: ivaPct, monto: aMoney(aCentavos(String(f.iva_valor))), incluidoEnPrecio: false },
      { codigo: 'TASA_MUNICIPAL', nombre: 'Tasa municipal', monto: aMoney(aCentavos(String(f.tasa))), incluidoEnPrecio: false },
    ];
    const historial = [{ estado: 'CONFIRMED', en: f.creada }];
    if (f.checkin_en) historial.push({ estado: 'CHECKED_IN', en: f.checkin_en });
    if (f.checkout_en) historial.push({ estado: 'CHECKED_OUT', en: f.checkout_en });
    if (estado === 'CANCELLED') historial.push({ estado: 'CANCELLED', en: f.cancelada_en ?? f.creada });
    const idRuta = String(f.id);
    return {
      orderId: idRuta,
      external_order_id: `ORD-HTL-${sufijo}`,
      externalOrderId: `ORD-HTL-${sufijo}`,
      codigoReserva: `BK-HOTEL-${sufijo}`,
      estado,
      ...(f.saga_id ? { saga_id: f.saga_id } : {}),
      alojamientoId: `HTL-${String(f.aloj_codigo)}`,
      alojamientoNombre: f.aloj_nombre,
      tipoHabitacionCodigo: f.codigo_tipo,
      tipoHabitacion: f.tipo_nombre,
      cantidadHabitaciones: f.cantidad,
      ocupantes: f.ocupantes,
      ...(f.regimen ? { regimen: f.regimen } : {}),
      checkinFecha: f.entrada,
      checkoutFecha: f.salida,
      noches: f.noches,
      checkinHabilitadoDesde: habilitado,
      earlyCheckinAutorizado: Boolean(f.early_checkin),
      ...(f.cotizacion_id ? { cotizacionId: f.cotizacion_id } : {}),
      huespedTitular: f.titular,
      desgloseFiscal: {
        subtotal: aMoney(aCentavos(String(f.subtotal))),
        ivaPorcentaje: ivaPct,
        ivaValor: aMoney(aCentavos(String(f.iva_valor))),
        iva15Pct: aMoney(aCentavos(String(f.iva_valor))),
        tasaMunicipal: aMoney(aCentavos(String(f.tasa))),
        descuentoCombo: aMoney(aCentavos(String(f.descuento))),
        total: aMoney(aCentavos(String(f.total))),
        impuestos,
      },
      total: aMoney(aCentavos(String(f.total))),
      currency: 'USD',
      politicaCancelacionAplicable: {
        ...(pol.horasLimiteCancelacion !== undefined ? { reembolso100HastaFecha: iso5(Date.parse(habilitado) - pol.horasLimiteCancelacion * 3_600_000) } : {}),
        descripcion: pol.descripcion,
        esReembolsable: pol.esReembolsable,
      },
      habitacionAsignada: f.habitacion_asignada ?? null,
      claveAccesoDigital: estado === 'CHECKED_IN' ? (f.clave_digital ?? null) : null,
      historialEstados: historial,
      createdAt: f.creada,
      _links: {
        self: { href: `${this.base}/orders/${idRuta}`, method: 'GET' },
        ...(estado === 'CONFIRMED' ? { checkin: { href: `${this.base}/orders/${idRuta}/check-in`, method: 'POST', description: `Check-in digital desde ${habilitado}` } } : {}),
        ...(estado === 'CHECKED_IN' ? { checkout: { href: `${this.base}/orders/${idRuta}/checkout`, method: 'POST', description: 'Check-out y liquidación de consumos' } } : {}),
        ...(estado === 'CONFIRMED' || estado === 'PENDING' ? { cancel: { href: `${this.base}/orders/${idRuta}/cancel`, method: 'POST', description: 'Cancelar (requiere Idempotency-Key)' } } : {}),
      },
      planTarifaCodigo: f.plan_tarifa,
      modeloPago: 'PREPAGO',
    };
  }
}

// ---------------------------------------------------------------------------
function estadoV2(e: string): string {
  switch (e) {
    case 'PENDIENTE':
      return 'PENDING';
    case 'CONFIRMADA':
      return 'CONFIRMED';
    case 'COMPLETADA':
      return 'CHECKED_OUT';
    default:
      return 'CANCELLED'; // CANCELADA, RECHAZADA, EXPIRADA
  }
}

function tipoPropiedad(nombre: string): string | undefined {
  const n = nombre.toLowerCase();
  if (n.includes('resort')) return 'RESORT';
  if (n.includes('hosteria') || n.includes('hostería')) return 'HOSTERIA';
  if (n.includes('hostal')) return 'HOSTAL';
  if (n.includes('hotel')) return 'HOTEL';
  if (n.includes('departamento') || n.includes('apartamento')) return 'APARTAMENTO';
  return undefined;
}

function desglose(p: Precio): Record<string, unknown> {
  return {
    precioNoche: aMoney(p.precioNocheC),
    subtotal: aMoney(p.subtotalC),
    ivaPorcentaje: p.ivaPct,
    ivaValor: aMoney(p.ivaC),
    iva15Pct: aMoney(p.ivaC),
    tasaMunicipal: aMoney(p.tasaC),
    descuentoCombo: aMoney(p.descuentoC),
    totalPagar: aMoney(p.totalC),
    impuestos: [
      { codigo: 'IVA', nombre: `IVA ${p.ivaPct} %`, porcentaje: p.ivaPct, monto: aMoney(p.ivaC), incluidoEnPrecio: false },
      { codigo: 'TASA_MUNICIPAL', nombre: 'Tasa municipal', monto: aMoney(p.tasaC), incluidoEnPrecio: false },
    ],
    nochesDetalle: p.nochesDetalle,
  };
}

/** {orderId} acepta UUID, ORD-HTL-… o BK-HOTEL-… -> [condición SQL, valor]. */
function condicionDeReferencia(ref: string): [string, string] {
  if (RE_UUID.test(ref)) return ['reserva.id = $1::uuid', ref];
  const ord = /^ORD-HTL-([A-Z0-9]{3,20})$/.exec(ref);
  if (ord) return ['reserva.codigo = $1', `BK-${ord[1]}`];
  const bk = /^BK-HOTEL-([A-Z0-9]{3,20})$/.exec(ref);
  if (bk) return ['reserva.codigo = $1', `BK-${bk[1]}`];
  throw invalido('Referencia de reserva inválida', [{ name: 'orderId', reason: 'UUID, ORD-HTL-… o BK-HOTEL-…' }]);
}

