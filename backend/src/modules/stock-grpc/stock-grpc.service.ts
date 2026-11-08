import { Injectable, OnModuleInit } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { logJson } from '../../common/logging/log-json';
import { hoyEcuador } from '../../common/http/respuestas';
import { DbService } from '../../database/db.service';
import { BusEventos, EventoNegocio } from '../jobs/bus-eventos';

export interface StockUpdateMessage {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  timestamp: number;
  slot_id: string;
  /** Solo para el canal REST (motivo del cambio); el canal gRPC lo ignora. */
  reason?: string;
}
export interface StockUpdateAck {
  success: boolean;
  message: string;
  processed_at: number;
  /** "OK" | "STALE_TIMESTAMP_IGNORED" | "ITEM_NOT_FOUND" | "INVALID_SLOT" */
  error_code: string;
  current_available: number;
}
export interface SlotAvailabilityRequest {
  service_id: string;
  item_id: string;
  date: string;
  time_slot: string;
  slot_id: string;
}
export interface SlotAvailabilityResponse {
  item_id: string;
  slot_id: string;
  date: string;
  time_slot: string;
  available_units: number;
  /** "DISPONIBLE" | "ULTIMOS_CUPOS" | "AGOTADO" */
  status: string;
  last_updated_epoch: number;
}
type Cb<T> = (err: grpc.ServiceError | null, res?: T) => void;
interface InventoryClient extends grpc.Client {
  PushStockUpdate: (req: StockUpdateMessage, options: grpc.CallOptions, cb: Cb<StockUpdateAck>) => void;
  GetSlotAvailability: (req: SlotAvailabilityRequest, options: grpc.CallOptions, cb: Cb<SlotAvailabilityResponse>) => void;
}
type InventoryClientCtor = new (target: string, creds: grpc.ChannelCredentials) => InventoryClient;

/** Eventos de reserva que cambian el stock (cualquier canal: Booking o el marketplace propio). */
const EVENTOS_QUE_CAMBIAN_STOCK = new Set(['ReservaCreada', 'ReservaConfirmada', 'ReservaCancelada', 'ReservaRechazada', 'ReservaExpirada', 'EstanciaCompletada']);
/** Motivo (`reason`) que se informa a Booking en el canal REST. Confirmar con Booking los valores aceptados. */
const MOTIVO_POR_EVENTO: Record<string, string> = {
  ReservaCreada: 'ORDER_CREATED',
  ReservaConfirmada: 'ORDER_CREATED',
  ReservaCancelada: 'ORDER_CANCELLED',
  ReservaRechazada: 'ORDER_CANCELLED',
  ReservaExpirada: 'ORDER_EXPIRED',
  EstanciaCompletada: 'STAY_COMPLETED',
};
const PLAZO_MS = 3000;
const INTENTOS = 3;
const CONCURRENCIA = 10;

/**
 * Cliente gRPC del stock (contrato v2, §5). Posada EC es CLIENTE: empuja a Booking `available_units` absolutos,
 * una vez por noche. Se activa con STOCK_GRPC_TARGET (p. ej. 100.x.y.z:50051). Sin TLS en la prueba local; con STOCK_GRPC_TLS=true se cifra el canal.
 * Nunca bloquea una reserva: los fallos se registran y la siguiente actualización (o `npm run stock:cargar`) reconcilia.
 */
@Injectable()
export class StockGrpcService implements OnModuleInit {
  private cliente?: InventoryClient;
  readonly contadores = { enviados: 0, fallidos: 0, obsoletos: 0 };

  constructor(
    private readonly db: DbService,
    private readonly bus: BusEventos,
  ) {}

  get objetivo(): string {
    return (process.env.STOCK_GRPC_TARGET || '').trim();
  }
  /** Canal REST de Booking: POST {STOCK_REST_URL}/api/v3/inventory/stock con X-API-Key (tiene prioridad sobre gRPC). */
  get urlRest(): string {
    return (process.env.STOCK_REST_URL || '').trim().replace(/\/$/, '');
  }
  get modo(): 'rest' | 'grpc' | null {
    if (process.env.STOCK_GRPC_ENABLED === 'false') return null;
    if (this.urlRest !== '') return 'rest';
    return this.objetivo !== '' ? 'grpc' : null;
  }
  get habilitado(): boolean {
    return this.modo !== null;
  }
  private get serviceId(): string {
    return process.env.STOCK_SERVICE_ID || 'alojamientos';
  }

  onModuleInit(): void {
    if (!this.habilitado) {
      logJson('info', 'stock_grpc_desactivado', { motivo: 'STOCK_REST_URL y STOCK_GRPC_TARGET vacíos' });
      return;
    }
    logJson('info', 'stock_activo', { canal: this.modo, destino: this.modo === 'rest' ? this.urlRest : this.objetivo, service_id: this.serviceId });
    this.bus.suscribir((e) => this.alEvento(e));
  }

  /** Consumidor del bus: dispara y olvida (el bus corre dentro de la transacción del outbox). */
  private alEvento(e: EventoNegocio): void {
    if (!EVENTOS_QUE_CAMBIAN_STOCK.has(e.tipo)) return;
    const reservaId = e.payload?.reservaId;
    if (typeof reservaId !== 'string') return;
    this.publicarReserva(reservaId, MOTIVO_POR_EVENTO[e.tipo] ?? 'MANUAL_ADJUSTMENT').catch((err: unknown) =>
      logJson('error', 'stock_grpc_error', { reserva_id: reservaId, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  /** Reenvía el stock de las noches de una reserva (tras reservar, cancelar, expirar...). */
  async publicarReserva(reservaId: string, motivo = 'MANUAL_ADJUSTMENT'): Promise<number> {
    const lineas = await this.db.query<{ unidad_id: string; entrada: string; salida: string }>(
      `SELECT d.unidad_id::text AS unidad_id, r.fecha_entrada::text AS entrada, r.fecha_salida::text AS salida
         FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id WHERE d.reserva_id = $1`,
      [reservaId],
    );
    let n = 0;
    for (const l of lineas) n += await this.publicarRango(l.unidad_id, l.entrada, l.salida, motivo);
    return n;
  }

  /** Mensajes (uno por noche) del rango [entrada, salida) de una unidad, con el cupo absoluto actual. */
  async mensajesDeRango(unidadId: string, entrada: string, salida: string): Promise<StockUpdateMessage[]> {
    const filas = await this.db.query<{ item: string; fecha: string; libres: number; hora: string }>(
      `SELECT 'HTL-' || a.codigo || ':' || u.codigo_tipo AS item, n::date::text AS fecha, a.hora_checkin::text AS hora,
              GREATEST(COALESCE(c.cantidad_a_la_venta, u.cantidad)
                - COALESCE((SELECT sum(d.cantidad) FROM reserva_detalle d JOIN reserva r ON r.id = d.reserva_id
                             WHERE d.unidad_id = u.id AND r.estado IN ('PENDIENTE','CONFIRMADA','COMPLETADA')
                               AND r.fecha_entrada <= n::date AND r.fecha_salida > n::date), 0), 0)::int AS libres
         FROM unidad_alojamiento u
         JOIN alojamiento a ON a.id = u.alojamiento_id
        CROSS JOIN generate_series($2::date, $3::date - 1, interval '1 day') n
         LEFT JOIN calendario_unidad c ON c.unidad_id = u.id AND c.fecha = n::date
        WHERE u.id = $1 ORDER BY n`,
      [unidadId, entrada, salida],
    );
    const ahora = Date.now();
    return filas.map((f) => ({
      service_id: this.serviceId,
      item_id: f.item,
      date: f.fecha,
      time_slot: f.hora.slice(0, 5),
      available_units: f.libres,
      timestamp: ahora,
      slot_id: `slot-${f.fecha.replace(/-/g, '')}-${f.hora.slice(0, 5).replace(':', '')}`, // slot-YYYYMMDD-HHMM
    }));
  }

  async publicarRango(unidadId: string, entrada: string, salida: string, motivo = 'MANUAL_ADJUSTMENT'): Promise<number> {
    if (!this.habilitado) return 0;
    const mensajes = (await this.mensajesDeRango(unidadId, entrada, salida)).map((m) => ({ ...m, reason: motivo }));
    await this.enviarTodos(mensajes);
    return mensajes.length;
  }

  /** Carga inicial / reconciliación: todo el inventario de las próximas `dias` noches. */
  async cargarTodo(dias = 90): Promise<{ mensajes: number; enviados: number; fallidos: number; obsoletos: number }> {
    const desde = hoyEcuador();
    const hasta = new Date(Date.parse(`${desde}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
    const unidades = await this.db.query<{ id: string }>(
      `SELECT u.id::text AS id FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id WHERE u.activa AND a.estado = 'PUBLICADO' ORDER BY a.codigo, u.codigo_tipo`,
    );
    const antes = { ...this.contadores };
    let total = 0;
    for (const u of unidades) {
      const m = (await this.mensajesDeRango(u.id, desde, hasta)).map((x) => ({ ...x, reason: 'INITIAL_LOAD' }));
      total += m.length;
      await this.enviarTodos(m);
    }
    return { mensajes: total, enviados: this.contadores.enviados - antes.enviados, fallidos: this.contadores.fallidos - antes.fallidos, obsoletos: this.contadores.obsoletos - antes.obsoletos };
  }

  private async enviarTodos(mensajes: StockUpdateMessage[]): Promise<void> {
    for (let i = 0; i < mensajes.length; i += CONCURRENCIA) {
      await Promise.all(mensajes.slice(i, i + CONCURRENCIA).map((m) => this.enviarConReintento(m)));
    }
  }

  private async enviarConReintento(m: StockUpdateMessage): Promise<void> {
    let ultimo = '';
    for (let intento = 1; intento <= INTENTOS; intento++) {
      try {
        const ack = await this.push(m);
        if (ack.success || ack.error_code === 'OK') {
          this.contadores.enviados++;
          return;
        }
        // Obsoleto: Booking ya tiene un dato más nuevo (regla monotónica). No se reintenta ni cuenta como fallo.
        if (ack.error_code === 'STALE_TIMESTAMP_IGNORED') {
          this.contadores.obsoletos++;
          return;
        }
        // ITEM_NOT_FOUND / INVALID_SLOT: reintentar no sirve (falta registrar el item en Booking o el turno es inválido)
        if (ack.error_code === 'ITEM_NOT_FOUND' || ack.error_code === 'INVALID_SLOT') {
          ultimo = `${ack.error_code}: ${ack.message}`;
          break;
        }
        ultimo = `rechazado: ${ack.error_code} ${ack.message}`;
      } catch (e) {
        ultimo = e instanceof Error ? e.message : String(e);
      }
      if (intento < INTENTOS) await new Promise((r) => setTimeout(r, 500 * 2 ** (intento - 1)));
    }
    this.contadores.fallidos++;
    logJson('error', 'stock_grpc_fallo', { item_id: m.item_id, date: m.date, error: ultimo });
  }

  /** REST: POST /api/v3/inventory/stock {item_id, available_units, date, reason} con X-API-Key. Un 2xx es éxito. */
  private async pushRest(m: StockUpdateMessage): Promise<StockUpdateAck> {
    const llave = process.env.STOCK_REST_API_KEY || '';
    const r = await fetch(`${this.urlRest}/api/v3/inventory/stock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(llave ? { 'x-api-key': llave } : {}) },
      body: JSON.stringify({ item_id: m.item_id, available_units: m.available_units, date: m.date, reason: m.reason ?? 'MANUAL_ADJUSTMENT' }),
      signal: AbortSignal.timeout(PLAZO_MS + 2000),
    });
    if (r.ok) return { success: true, message: 'OK', processed_at: Date.now(), error_code: 'OK', current_available: m.available_units };
    const detalle = (await r.text().catch(() => '')).slice(0, 200);
    // 404: item no registrado en Booking; 409: dato más nuevo ya aplicado; otros 4xx no se reintentan; 5xx sí.
    const codigo = r.status === 404 ? 'ITEM_NOT_FOUND' : r.status === 409 ? 'STALE_TIMESTAMP_IGNORED' : r.status >= 400 && r.status < 500 ? 'INVALID_SLOT' : `HTTP_${r.status}`;
    return { success: false, message: `HTTP ${r.status} ${detalle}`, processed_at: Date.now(), error_code: codigo, current_available: 0 };
  }

  /** Una llamada de stock por el canal activo (REST o gRPC unario, plazo de 3 s). */
  push(m: StockUpdateMessage): Promise<StockUpdateAck> {
    if (this.modo === 'rest') return this.pushRest(m);
    return new Promise((resolve, reject) => {
      this.obtenerCliente().PushStockUpdate(m, { deadline: Date.now() + PLAZO_MS }, (err, res) => {
        if (err) reject(err);
        else resolve(res as StockUpdateAck);
      });
    });
  }

  /** Consulta puntual (GetSlotAvailability): ¿qué cupo tiene Booking sincronizado para esta noche? */
  consultar(m: StockUpdateMessage): Promise<SlotAvailabilityResponse> {
    return new Promise((resolve, reject) => {
      const req: SlotAvailabilityRequest = { service_id: m.service_id, item_id: m.item_id, date: m.date, time_slot: m.time_slot, slot_id: m.slot_id };
      this.obtenerCliente().GetSlotAvailability(req, { deadline: Date.now() + PLAZO_MS }, (err, res) => {
        if (err) reject(err);
        else resolve(res as SlotAvailabilityResponse);
      });
    });
  }

  /** Primeras `n` noches de la primera unidad publicada, para comprobar la sincronización tras una carga. */
  async verificarMuestra(n = 3): Promise<{ item: string; fecha: string; nuestro: number; booking?: number; estado: string }[]> {
    const u = await this.db.uno<{ id: string }>(
      `SELECT u.id::text AS id FROM unidad_alojamiento u JOIN alojamiento a ON a.id = u.alojamiento_id WHERE u.activa AND a.estado = 'PUBLICADO' ORDER BY a.codigo, u.codigo_tipo LIMIT 1`,
    );
    if (!u) return [];
    const desde = hoyEcuador();
    const hasta = new Date(Date.parse(`${desde}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const salida: { item: string; fecha: string; nuestro: number; booking?: number; estado: string }[] = [];
    for (const m of await this.mensajesDeRango(u.id, desde, hasta)) {
      try {
        const r = await this.consultar(m);
        salida.push({ item: m.item_id, fecha: m.date, nuestro: m.available_units, booking: r.available_units, estado: r.available_units === m.available_units ? 'COINCIDE' : `DIFIERE (${r.status})` });
      } catch (e) {
        salida.push({ item: m.item_id, fecha: m.date, nuestro: m.available_units, estado: `sin respuesta: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    return salida;
  }

  private obtenerCliente(): InventoryClient {
    if (!this.cliente) {
      // dist/modules/stock-grpc -> backend/proto  (y src/modules/stock-grpc -> backend/proto en pruebas)
      const ruta = join(__dirname, '..', '..', '..', 'proto', 'inventory.proto');
      const def = protoLoader.loadSync(ruta, { keepCase: true, longs: Number, defaults: true, oneofs: true });
      const paquete = grpc.loadPackageDefinition(def) as unknown as { inventory: { InventoryStockService: InventoryClientCtor } };
      // STOCK_GRPC_TLS=true cifra el canal (obligatorio si Booking está en Internet; sin TLS solo en red privada/Tailscale)
      const credenciales = process.env.STOCK_GRPC_TLS === 'true' ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
      this.cliente = new paquete.inventory.InventoryStockService(this.objetivo, credenciales);
    }
    return this.cliente;
  }
}
