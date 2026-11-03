#!/usr/bin/env node
/**
 * Servidor gRPC FALSO que imita la ingesta de stock de Booking (puerto 50051, sin TLS).
 * Usa el MISMO inventory.proto que mandó Booking (backend/proto/inventory.proto).
 *
 *   Terminal 1:  npm run stock:falso
 *   Terminal 2:  en backend/.env pon STOCK_GRPC_TARGET=127.0.0.1:50051 y ejecuta  npm run stock:cargar -- 7
 *
 * Imita las reglas del .proto real: regla MONOTÓNICA (timestamp menor al último -> STALE_TIMESTAMP_IGNORED),
 * INVALID_SLOT (date/time_slot/slot_id mal formados), ITEM_NOT_FOUND (item_id sin el formato <alojamientoId>:<TIPO>)
 * y GetSlotAvailability (DISPONIBLE / ULTIMOS_CUPOS <= 5 / AGOTADO).
 * Variables: PORT_STOCK (por defecto 50051), VER_TODO=1 imprime todos los mensajes.
 */
const path = require('path');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');

const def = loader.loadSync(path.join(__dirname, '..', 'proto', 'inventory.proto'), { keepCase: true, longs: Number, defaults: true });
const pkg = grpc.loadPackageDefinition(def).inventory;
const estado = new Map(); // item|fecha|slot -> { unidades, timestamp }
let total = 0;

function problema(m) {
  if (!m.service_id) return ['INVALID_SLOT', 'service_id vacío'];
  if (!/^[A-Za-z0-9._-]{3,64}:[A-Z0-9_]{2,40}$/.test(m.item_id)) return ['ITEM_NOT_FOUND', `item_id inválido: ${m.item_id}`];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return ['INVALID_SLOT', `date inválida: ${m.date}`];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time_slot)) return ['INVALID_SLOT', `time_slot inválido: ${m.time_slot}`];
  const esperado = `slot-${m.date.replace(/-/g, '')}-${m.time_slot.replace(':', '')}`;
  if (m.slot_id !== esperado) return ['INVALID_SLOT', `slot_id ${m.slot_id} != ${esperado}`];
  if (!Number.isInteger(m.available_units) || m.available_units < 0) return ['INVALID_SLOT', `available_units inválido: ${m.available_units}`];
  return null;
}
const clave = (m) => `${m.item_id}|${m.date}|${m.slot_id}`;

const servidor = new grpc.Server();
servidor.addService(pkg.InventoryStockService.service, {
  PushStockUpdate(call, cb) {
    const m = call.request;
    total++;
    const p = problema(m);
    if (p) {
      console.log('RECHAZADO', p[0], p[1]);
      return cb(null, { success: false, message: p[1], processed_at: Date.now(), error_code: p[0], current_available: 0 });
    }
    const previo = estado.get(clave(m));
    if (previo && m.timestamp < previo.timestamp) {
      return cb(null, { success: false, message: 'obsoleto', processed_at: Date.now(), error_code: 'STALE_TIMESTAMP_IGNORED', current_available: previo.unidades });
    }
    estado.set(clave(m), { unidades: m.available_units, timestamp: m.timestamp });
    if (process.env.VER_TODO || total <= 20 || total % 100 === 0) console.log(`#${total} ${m.service_id} ${m.item_id} ${m.date} ${m.time_slot} ${m.slot_id} -> ${m.available_units} unidades`);
    cb(null, { success: true, message: 'ok', processed_at: Date.now(), error_code: 'OK', current_available: m.available_units });
  },
  StreamInventoryChanges(call, cb) {
    let n = 0;
    call.on('data', () => n++);
    call.on('end', () => cb(null, { total_events_processed: n, is_synchronized: true, last_sync_hash: '' }));
  },
  GetSlotAvailability(call, cb) {
    const r = call.request;
    const e = estado.get(`${r.item_id}|${r.date}|${r.slot_id}`);
    const u = e ? e.unidades : 0;
    cb(null, {
      item_id: r.item_id, slot_id: r.slot_id, date: r.date, time_slot: r.time_slot, available_units: u,
      status: u === 0 ? 'AGOTADO' : u <= 5 ? 'ULTIMOS_CUPOS' : 'DISPONIBLE', last_updated_epoch: e ? e.timestamp : 0,
    });
  },
});

const puerto = process.env.PORT_STOCK || '50051';
servidor.bindAsync(`0.0.0.0:${puerto}`, grpc.ServerCredentials.createInsecure(), (err) => {
  if (err) {
    console.error('No se pudo abrir el puerto', puerto, err.message);
    process.exit(1);
  }
  console.log(`Servidor de stock FALSO escuchando en 0.0.0.0:${puerto} (sin TLS). Ctrl+C para salir.`);
});
process.on('SIGINT', () => {
  console.log(`\nTotal recibido: ${total} mensajes, ${estado.size} noches distintas.`);
  process.exit(0);
});
