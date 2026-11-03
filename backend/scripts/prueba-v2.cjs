/**
 * Prueba de integración del contrato v2 (Reto 2, semana 9): recorre health, catálogo, availability,
 * orders/create (idempotencia, errores 4xx), consulta y cancelación contra el backend LOCAL en marcha.
 *
 *   1) docker compose up -d   2) cd backend && npm run start:dev   3) npm run test:v2
 *
 * Crea y cancela reservas de prueba (fechas a ~30 días). Usar solo con la BD local, no con Supabase real.
 * Variables: BASE_URL (por defecto http://127.0.0.1:$PORT), DATABASE_URL y JWT_SECRET (del .env).
 */
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const B = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DB = process.env.DATABASE_URL;
const SECRET = process.env.JWT_SECRET;
let ok = 0, mal = 0;
const check = (nombre, cond, extra) => { if (cond) { ok++; console.log('  OK  ', nombre); } else { mal++; console.log('  FALLA', nombre, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sumaFecha = (n) => new Date(Date.now() - 5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const uuid = () => require('crypto').randomUUID();
async function http(method, path, { token, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  let json; try { json = txt ? JSON.parse(txt) : undefined; } catch { json = txt; }
  return { status: r.status, json, h: r.headers };
}
(async () => {
  const c = new Client({ connectionString: DB }); await c.connect();
  const unidad = (await c.query(`SELECT a.codigo, u.codigo_tipo, u.capacidad_huespedes, u.cantidad FROM booking.alojamiento a JOIN booking.unidad_alojamiento u ON u.alojamiento_id=a.id WHERE a.estado='PUBLICADO' AND u.activa AND a.noches_min=1 ORDER BY a.codigo, u.precio_noche_base LIMIT 1`)).rows[0];
  console.log('unidad de prueba:', unidad);
  const aloj = 'HTL-' + unidad.codigo, tipo = unidad.codigo_tipo;
  const token = execFileSync('node', [require('path').join(__dirname, 'token-servicio.js')], { env: process.env }).toString().split('\n').find((l) => l.startsWith('eyJ'));
  check('token de servicio generado', !!token);

  console.log('\n[health]');
  let r = await http('GET', '/api/v2/alojamientos/health');
  check('200 HEALTHY', r.status === 200 && r.json.status === 'HEALTHY', r.json);
  check('trae metrics y x-correlation-id', !!r.json.metrics && !!r.h.get('x-correlation-id'), r.json);

  console.log('\n[catalogo]');
  r = await http('GET', '/api/v2/alojamientos?limit=2');
  check('200 con data y metadata', r.status === 200 && Array.isArray(r.json.data) && r.json.metadata.limit === 2, r.json);
  check('precioPorNoche es Money', /^\d+\.\d{2}$/.test(r.json.data[0].precioPorNoche), r.json.data[0]);
  const etag = r.h.get('etag');
  const r304 = await http('GET', '/api/v2/alojamientos?limit=2', { headers: { 'if-none-match': etag } });
  check('304 con If-None-Match', r304.status === 304, r304.status);
  r = await http('GET', '/api/v2/alojamientos?limit=100');
  check('limit=100 -> 400 con invalid_params', r.status === 400 && r.json.invalid_params?.[0]?.name === 'limit', r.json);

  console.log('\n[availability]');
  const ini = sumaFecha(30), fin = sumaFecha(33);
  const req = { alojamientoId: aloj, tipoHabitacionCodigo: tipo, fechaInicio: ini, fechaFin: fin, cantidadHabitaciones: 1, ocupantes: { adultos: 1, ninos: 0 } };
  r = await http('POST', '/api/v2/alojamientos/availability', { body: req });
  check('200 con cotizacionId', r.status === 200 && !!r.json.cotizacionId, r.json);
  const d = r.json.desglosePrecio;
  const cent = (s) => Math.round(Number(s) * 100);
  check('total = subtotal + iva + tasa - combo', cent(d.totalPagar) === cent(d.subtotal) + cent(d.ivaValor) + cent(d.tasaMunicipal) - cent(d.descuentoCombo), d);
  check('subtotal = suma de nochesDetalle', cent(d.subtotal) === d.nochesDetalle.reduce((s, n) => s + cent(n.precio), 0), d);
  check('tasa municipal = 2.00 x 3 noches', d.tasaMunicipal === '6.00', d.tasaMunicipal);
  check('precioTotalCotizado = totalPagar', r.json.precioTotalCotizado === d.totalPagar);
  const cot = r.json;
  console.log('  desglose:', JSON.stringify({ sub: d.subtotal, iva: d.ivaValor, tasa: d.tasaMunicipal, total: d.totalPagar }));
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, campoRaro: 1 } });
  check('campo desconocido -> 400', r.status === 400 && r.json.code === 'VALIDATION_FAILED' && r.json.instance, r.json);
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, fechaFin: ini } });
  check('fechaFin = fechaInicio -> 422 VALIDATION_FAILED', r.status === 422 && r.json.invalid_params?.[0]?.name === 'fechaFin', r.json);
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, currency: 'EUR' } });
  check('EUR -> 422 UNSUPPORTED_CURRENCY', r.status === 422 && r.json.code === 'UNSUPPORTED_CURRENCY', r.json);
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, tipoHabitacionCodigo: 'NO_EXISTE' } });
  check('tipo inexistente -> 404 NOT_FOUND', r.status === 404 && r.json.code === 'NOT_FOUND', r.json);
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, cantidadHabitaciones: 10 } });
  check('10 habitaciones -> 409 OUT_OF_STOCK o 422 CAPACITY_EXCEEDED', (r.status === 409 && r.json.code === 'OUT_OF_STOCK') || (r.status === 422 && r.json.code === 'CAPACITY_EXCEEDED'), r.json);
  r = await http('POST', '/api/v2/alojamientos/availability', { body: { ...req, ocupantes: { adultos: 20, ninos: 0 } } });
  check('20 adultos -> 422 CAPACITY_EXCEEDED', r.status === 422 && r.json.code === 'CAPACITY_EXCEEDED', r.json);

  console.log('\n[orders/create]');
  const orden = {
    ...req, cotizacionId: cot.cotizacionId, totalPagar: cot.precioTotalCotizado, currency: 'USD', payment_method: 'TARJETA_CREDITO', payment_reference: 'AUTH-VISA-982341',
    saga_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    huespedTitular: { nombreCompleto: 'Joselyn Cadena', tipoDocumento: 'CEDULA', identificacion: '1712345675', email: 'jlcadenac@puce.edu.ec', telefono: '+593991234567', nacionalidad: 'Ecuatoriana' },
  };
  r = await http('POST', '/api/v2/alojamientos/orders/create', { body: orden, headers: { 'idempotency-key': uuid() } });
  check('sin token -> 401 UNAUTHORIZED con instance', r.status === 401 && r.json.code === 'UNAUTHORIZED' && r.json.instance === '/api/v2/alojamientos/orders/create', r.json);
  const soloLeer = jwt.sign({ sub: (await c.query(`select id from booking.usuario where email='esb-booking@servicio.posada.ec'`)).rows[0].id, email: 'x@x.com', rol: 'USUARIO', scope: 'alojamientos:read' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token: soloLeer, body: orden, headers: { 'idempotency-key': uuid() } });
  check('token sin scope book -> 403 INSUFFICIENT_SCOPE', r.status === 403 && r.json.code === 'INSUFFICIENT_SCOPE' && r.json.scopes_requeridos?.[0] === 'alojamientos:book', r.json);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: orden });
  check('sin Idempotency-Key -> 400', r.status === 400, r.json);

  const clave = uuid();
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: orden, headers: { 'idempotency-key': clave, 'x-correlation-id': 'corr-prueba-0001' } });
  check('201 creada', r.status === 201, r.json);
  const o = r.json;
  check('estado CONFIRMED + ids con formato', o.estado === 'CONFIRMED' && /^ORD-HTL-[A-Z0-9]{3,20}$/.test(o.external_order_id) && /^BK-HOTEL-[A-Z0-9]{3,20}$/.test(o.codigoReserva), o);
  check('desgloseFiscal.total = total cotizado', o.desgloseFiscal?.total === cot.precioTotalCotizado && o.total === cot.precioTotalCotizado, o.desgloseFiscal);
  check('Location y X-Correlation-ID', !!r.h.get('location') && r.h.get('x-correlation-id') === 'corr-prueba-0001');
  check('titular y saga_id devueltos', o.huespedTitular?.identificacion === '1712345675' && o.saga_id === orden.saga_id);
  const r2 = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: orden, headers: { 'idempotency-key': clave } });
  check('mismo body + misma clave -> replay mismo orderId', r2.status === 201 && r2.json.orderId === o.orderId && r2.h.get('idempotent-replayed') === 'true', [r2.status, r2.json]);
  const r3 = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: { ...orden, huespedTitular: { ...orden.huespedTitular, telefono: '0991234567' } }, headers: { 'idempotency-key': clave } });
  check('otra carga + misma clave -> 422 IDEMPOTENCY_KEY_REUSED', r3.status === 422 && r3.json.code === 'IDEMPOTENCY_KEY_REUSED', r3.json);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: { ...orden, totalPagar: '1.00' }, headers: { 'idempotency-key': uuid() } });
  check('total distinto -> 409 PRICE_MISMATCH', r.status === 409 && r.json.code === 'PRICE_MISMATCH', r.json);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: { ...orden, huespedTitular: { ...orden.huespedTitular, identificacion: '1712345670' } }, headers: { 'idempotency-key': uuid() } });
  check('cédula con módulo 10 malo -> 422 INVALID_DOCUMENT', r.status === 422 && r.json.code === 'INVALID_DOCUMENT', r.json);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: { ...orden, paquete: { paqueteId: uuid(), descuentoPorcentaje: 10, descuentoMonto: '1.00' } }, headers: { 'idempotency-key': uuid() } });
  check('paquete -> 422 PROMOTIONS_NOT_ALLOWED', r.status === 422 && r.json.code === 'PROMOTIONS_NOT_ALLOWED', r.json);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: { ...orden, cotizacionId: uuid() }, headers: { 'idempotency-key': uuid() } });
  check('cotización inexistente -> 404', r.status === 404, r.json);
  await c.query(`UPDATE booking.cotizacion_v2 SET valida_hasta = now() - interval '1 minute' WHERE id = $1`, [cot.cotizacionId]);
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: orden, headers: { 'idempotency-key': uuid() } });
  check('cotización vencida -> 409 QUOTE_EXPIRED', r.status === 409 && r.json.code === 'QUOTE_EXPIRED', r.json);
  // sin cotizacionId: precio vigente
  const sinCot = { ...orden }; delete sinCot.cotizacionId;
  r = await http('POST', '/api/v2/alojamientos/orders/create', { token, body: sinCot, headers: { 'idempotency-key': uuid() } });
  check('sin cotizacionId pero con total correcto -> 201', r.status === 201, r.json);
  const o2 = r.json;

  console.log('\n[orders GET]');
  for (const ref of [o.orderId, o.external_order_id, o.codigoReserva]) {
    r = await http('GET', '/api/v2/alojamientos/orders/' + ref, { token });
    check('GET por ' + ref.slice(0, 12), r.status === 200 && r.json.orderId === o.orderId, r.json);
  }
  r = await http('GET', '/api/v2/alojamientos/orders/ORD-HTL-ZZZZZZZZ', { token });
  check('inexistente -> 404', r.status === 404 && r.json.code === 'NOT_FOUND', r.json);
  r = await http('GET', '/api/v2/alojamientos/orders/xx', { token });
  check('referencia mal formada -> 400', r.status === 400, r.json);
  const otro = (await c.query(`select id, email from booking.usuario where rol='USUARIO' and email <> 'esb-booking@servicio.posada.ec' limit 1`)).rows[0];
  const tokOtro = jwt.sign({ sub: otro.id, email: otro.email, rol: 'USUARIO', scope: 'alojamientos:read alojamientos:book alojamientos:cancel' }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  r = await http('GET', '/api/v2/alojamientos/orders/' + o.orderId, { token: tokOtro });
  check('otro cliente -> 403 FORBIDDEN', r.status === 403 && r.json.code === 'FORBIDDEN', r.json);

  console.log('\n[cancel]');
  r = await http('POST', `/api/v2/alojamientos/orders/${o.external_order_id}/cancel`, { token, body: { solicitadoPor: 'SAGA_ORCHESTRATOR', motivo: 'Fallo de pago' }, headers: { 'idempotency-key': uuid() } });
  check('200 CANCELLED COMPENSATED 100%', r.status === 200 && r.json.estado === 'CANCELLED' && r.json.refundStatus === 'COMPENSATED' && r.json.porcentajeReembolso === 100 && r.json.yaCancelada === false, r.json);
  check('codigoReembolso formato y monto = total', /^REF-HTL-[0-9]{5,10}$/.test(r.json.codigoReembolso) && r.json.montoReembolsado === o.total, r.json);
  const cod = r.json.codigoReembolso;
  r = await http('POST', `/api/v2/alojamientos/orders/${o.external_order_id}/cancel`, { token, body: { solicitadoPor: 'SAGA_ORCHESTRATOR' }, headers: { 'idempotency-key': uuid() } });
  check('reintento (otra clave) -> yaCancelada=true, mismo codigoReembolso', r.status === 200 && r.json.yaCancelada === true && r.json.codigoReembolso === cod, r.json);
  r = await http('GET', '/api/v2/alojamientos/orders/' + o.orderId, { token });
  check('GET ahora CANCELLED', r.json.estado === 'CANCELLED', r.json.estado);
  r = await http('POST', `/api/v2/alojamientos/orders/${o2.orderId}/cancel`, { token, headers: { 'idempotency-key': uuid() } });
  check('cancel CLIENTE sin body -> 200 con política', r.status === 200 && r.json.estado === 'CANCELLED' && ['REFUNDED', 'NO_REFUND'].includes(r.json.refundStatus), r.json);
  console.log('  cancel CLIENTE:', JSON.stringify({ pct: r.json.porcentajeReembolso, reembolso: r.json.montoReembolsado, penalidad: r.json.penalidad }));
  r = await http('POST', `/api/v2/alojamientos/orders/${o.orderId}/cancel`, { token, body: { motivo: 'x', extra: 1 }, headers: { 'idempotency-key': uuid() } });
  check('cancel con campo desconocido -> 400', r.status === 400, r.json);

  console.log('\n[search]');
  const ciudad = (await c.query(`SELECT c.nombre FROM booking.alojamiento a JOIN booking.ciudad c ON c.id = a.ciudad_id WHERE a.codigo = $1`, [unidad.codigo])).rows[0].nombre;
  const busca = { destino: ciudad, fechaInicio: ini, fechaFin: fin, adultos: 1 };
  r = await http('POST', '/api/v2/alojamientos/search', { body: busca });
  check('200 público con request_id, metadata y data', r.status === 200 && !!r.json.request_id && r.json.metadata?.noches === 3 && Array.isArray(r.json.data), r.json);
  const tarjeta = (r.json.data || []).find((x) => x.id === aloj);
  check('incluye el alojamiento de prueba con precioTotalEstancia Money', !!tarjeta && /^\d+\.\d{2}$/.test(tarjeta.precioTotalEstancia) && /^\d+\.\d{2}$/.test(tarjeta.precioPorNoche), tarjeta);
  check('alias deprecado "alojamientos" = data', Array.isArray(r.json.alojamientos) && r.json.alojamientos.length === r.json.data.length);
  r = await http('POST', '/api/v2/alojamientos/search', { body: { ...busca, destino: 'Atlantis' } });
  check('destino sin resultados -> 200 con data vacía', r.status === 200 && r.json.data.length === 0 && r.json.metadata.total_results === 0, r.json);
  r = await http('POST', '/api/v2/alojamientos/search', { body: { ...busca, precioMaximo: '0.01' } });
  check('precioMaximo 0.01 -> sin resultados', r.status === 200 && r.json.data.length === 0, r.json);
  r = await http('POST', '/api/v2/alojamientos/search', { body: { ...busca, campoRaro: 1 } });
  check('campo desconocido -> 400', r.status === 400 && r.json.code === 'VALIDATION_FAILED', r.json);
  r = await http('POST', '/api/v2/alojamientos/search', { body: { ...busca, fechaFin: ini } });
  check('fechaFin = fechaInicio -> 422', r.status === 422 && r.json.invalid_params?.[0]?.name === 'fechaFin', r.json);
  r = await http('POST', '/api/v2/alojamientos/search', { body: { ...busca, adultos: 0 } });
  check('adultos 0 -> 400 con invalid_params', r.status === 400 && r.json.invalid_params?.[0]?.name === 'adultos', r.json);

  console.log('\n[orders GET lista: saga_id / idempotency_key / external_order_id]');
  r = await http('GET', '/api/v2/alojamientos/orders?saga_id=' + orden.saga_id, { token });
  check('saga_id -> 200 con la orden creada', r.status === 200 && r.json.data.some((x) => x.orderId === o.orderId) && r.json.metadata.total_results >= 2, r.json?.metadata);
  r = await http('GET', '/api/v2/alojamientos/orders?external_order_id=' + o.external_order_id, { token });
  check('external_order_id -> exactamente 1', r.status === 200 && r.json.metadata.total_results === 1 && r.json.data[0].orderId === o.orderId, r.json);
  r = await http('GET', '/api/v2/alojamientos/orders?idempotency_key=' + clave, { token });
  check('idempotency_key -> la misma orden', r.status === 200 && r.json.metadata.total_results === 1 && r.json.data[0].orderId === o.orderId, r.json);
  r = await http('GET', '/api/v2/alojamientos/orders?saga_id=no-existe-' + uuid(), { token });
  check('saga_id inexistente -> 200 lista vacía', r.status === 200 && r.json.data.length === 0 && r.json.metadata.total_results === 0, r.json);
  r = await http('GET', '/api/v2/alojamientos/orders?estado=RARO', { token });
  check('estado inválido -> 400', r.status === 400 && r.json.invalid_params?.[0]?.name === 'estado', r.json);
  r = await http('GET', '/api/v2/alojamientos/orders?limit=100', { token });
  check('limit=100 -> 400', r.status === 400, r.json);
  r = await http('GET', '/api/v2/alojamientos/orders?saga_id=' + orden.saga_id);
  check('sin credenciales -> 401', r.status === 401, r.json);

  console.log('\n[X-API-Key]');
  const LLAVE = process.env.SERVICE_API_KEY;
  if (!LLAVE || LLAVE.length < 24) {
    console.log('  (omitido: define SERVICE_API_KEY de 24+ caracteres en backend/.env y reinicia el backend)');
  } else {
    r = await http('GET', '/api/v2/alojamientos/orders?saga_id=' + orden.saga_id, { headers: { 'x-api-key': LLAVE } });
    check('llave válida -> 200 y ve las órdenes de la cuenta de servicio', r.status === 200 && r.json.data.some((x) => x.orderId === o.orderId), r.json);
    r = await http('GET', '/api/v2/alojamientos/orders/' + o.external_order_id, { headers: { 'x-api-key': LLAVE } });
    check('llave válida en GET orders/{id} -> 200', r.status === 200 && r.json.orderId === o.orderId, r.json);
    r = await http('GET', '/api/v2/alojamientos/orders?saga_id=' + orden.saga_id, { headers: { 'x-api-key': LLAVE + 'x' } });
    check('llave incorrecta -> 401', r.status === 401, r.json);
    r = await http('GET', '/api/v1/orders/00000000-0000-0000-0000-000000000000', { headers: { 'x-api-key': LLAVE } });
    check('la llave no sirve en /api/v1 -> 401', r.status === 401, r.json);
  }

  console.log('\n[inventario]');
  const rutaInv = `/api/v2/alojamientos/${aloj}/inventario?desde=${ini}&hasta=${fin}&tipoHabitacion=${tipo}`;
  r = await http('GET', rutaInv, { token });
  check('200 con 4 noches y hash SHA-256', r.status === 200 && r.json.noches?.length === 4 && /^[0-9a-f]{64}$/.test(r.json.hash), r.json);
  check('disponibles = totales - reservadas - bloqueadas', (r.json.noches || []).every((n) => n.disponibles === n.habitacionesTotales - n.reservadas - n.bloqueadas), r.json.noches);
  r = await http('GET', rutaInv, { token: soloLeer });
  check('sin scope inventory -> 403 INSUFFICIENT_SCOPE', r.status === 403 && r.json.code === 'INSUFFICIENT_SCOPE', r.json);
  r = await http('GET', `/api/v2/alojamientos/${aloj}/inventario?desde=${ini}&hasta=${sumaFecha(200)}`, { token });
  check('más de 92 noches -> 422', r.status === 422, r.json);

  console.log('\n[v1 sigue igual]');
  r = await http('GET', '/health');
  check('GET /health 200', r.status === 200);
  r = await http('GET', '/api/v1/orders/00000000-0000-0000-0000-000000000000');
  check('v1 sin token -> 401 forma v1 (sin instance)', r.status === 401 && r.json.code === 'VALIDATION_FAILED' && r.json.instance === undefined && r.json.extras === undefined, r.json);

  const ev = (await c.query(`select tipo, count(*)::int n from booking.evento_outbox group by tipo order by tipo`)).rows;
  console.log('\neventos en el outbox:', JSON.stringify(ev));
  await c.end();
  console.log(`\nRESULTADO: ${ok} OK, ${mal} FALLAS`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error('EXCEPCION', e); process.exit(2); });
