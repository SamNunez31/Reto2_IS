import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { cedulaValida } from '../../common/validation/validadores-ec';
import { UsuarioToken } from '../../common/auth/decorators';
import { hoyEcuador, noches as contarNoches } from '../../common/http/respuestas';
import { InvalidParam, ProblemException, invalido } from '../../common/problem/problem';
import { logJson } from '../../common/logging/log-json';
import { DbService } from '../../database/db.service';
import {
  ComunV2,
  RE_MONEY,
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
    try {
      await this.db.query('SELECT 1');
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
    const latencia = Date.now() - t0;
    const semaforo = !conectada || latencia > 800 ? 'RED' : latencia >= 200 ? 'YELLOW' : 'GREEN';
    const status = !conectada ? 'DOWN' : semaforo === 'GREEN' ? 'HEALTHY' : 'DEGRADED';
    return {
      http: conectada ? 200 : 503,
      cuerpo: {
        status,
        semaforo,
        service: 'MS_ALOJAMIENTOS',
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
      const fila = await q<{ id: string; estado: string; huesped_id: string; codigo: string }>(
        `SELECT r.id::text AS id, r.estado::text AS estado, r.huesped_id::text AS huesped_id, r.codigo
           FROM reserva r JOIN orden_v2 o ON o.reserva_id = r.id WHERE ${cond.replace(/reserva\.id/, 'r.id').replace(/reserva\.codigo/, 'r.codigo')} FOR UPDATE OF r`,
        [valor],
      );
      if (!fila.length) throw noEncontradoV2(`La reserva ${ref} no existe`);
      const r = fila[0];
      if (r.huesped_id !== usuario.sub && usuario.rol !== 'ADMIN') throw new ProblemException(403, 'FORBIDDEN', 'La reserva pertenece a otro cliente');

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
              o.descuento_combo::text AS descuento, o.total::text AS total, ${TS('o.cancelada_en')} AS cancelada_en
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
    const estado = estadoV2(String(f.estado));
    const hora = String(f.hora_checkin);
    const habilitado = `${String(f.entrada)}T${hora.slice(0, 8)}-05:00`;
    const pol = (await this.politica(Number(f.politica_id))) as { esReembolsable: boolean; horasLimiteCancelacion?: number; descripcion: string };
    const ivaPct = Number(f.iva_pct);
    const impuestos = [
      { codigo: 'IVA', nombre: `IVA ${ivaPct} %`, porcentaje: ivaPct, monto: aMoney(aCentavos(String(f.iva_valor))), incluidoEnPrecio: false },
      { codigo: 'TASA_MUNICIPAL', nombre: 'Tasa municipal', monto: aMoney(aCentavos(String(f.tasa))), incluidoEnPrecio: false },
    ];
    const historial = [{ estado: 'CONFIRMED', en: f.creada }];
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
      earlyCheckinAutorizado: false,
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
      habitacionAsignada: null,
      claveAccesoDigital: null,
      historialEstados: historial,
      createdAt: f.creada,
      _links: {
        self: { href: `${this.base}/orders/${idRuta}`, method: 'GET' },
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

