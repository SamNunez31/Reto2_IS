/**
 * Reto 2 (S9) — Contract testing consumer-driven con Pact.
 * Consumidor: Booking Prototipo. Proveedor: Posada EC (NODE_ALO_PEC).
 * Cada interacción es lo MÍNIMO que Booking necesita; si Posada cambia algo de esto, la verificación del
 * proveedor (npm run pact:verificar) falla ANTES de desplegar. Genera pacts/Booking-Prototipo-Posada-EC.json.
 */
import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import * as path from 'path';

const { like, integer, regex, eachLike } = MatchersV3;

const pact = new PactV3({
  consumer: 'Booking-Prototipo',
  provider: 'Posada-EC',
  dir: path.resolve(__dirname, '../../pacts'),
  logLevel: 'warn',
});

async function get(base: string, ruta: string): Promise<Response> {
  return fetch(`${base}${ruta}`, { headers: { accept: 'application/json' } });
}

describe('Contrato Booking → Posada EC (consumidor)', () => {
  it('health: semáforo del nodo (lo consulta el Monitor de Nodos)', async () => {
    pact
      .given('la base de datos está conectada')
      .uponReceiving('una consulta de salud del nodo')
      .withRequest({ method: 'GET', path: '/api/v2/alojamientos/health' })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          status: regex(/^(HEALTHY|DEGRADED)$/, 'HEALTHY'),
          semaforo: regex(/^(GREEN|YELLOW)$/, 'GREEN'),
          service: 'MS_ALOJAMIENTOS',
          vertical: 'ALOJAMIENTOS',
          version: regex(/^2\.\d+\.\d+$/, '2.2.0'),
          latency_ms: integer(12),
          database: { status: 'CONNECTED' },
        },
      });
    await pact.executeTest(async (mock) => {
      const r = await get(mock.url, '/api/v2/alojamientos/health');
      expect(r.status).toBe(200);
      const b = (await r.json()) as { vertical: string };
      expect(b.vertical).toBe('ALOJAMIENTOS');
    });
  });

  it('categorías: catálogo de tipos de alojamiento', async () => {
    pact
      .given('existen tipos de alojamiento')
      .uponReceiving('una consulta de categorías')
      .withRequest({ method: 'GET', path: '/api/v2/alojamientos/categorias', headers: { Accept: 'application/json' } })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: eachLike({ id: regex(/^CAT-\d+$/, 'CAT-1'), nombre: like('Hotel'), slug: like('hotel'), orden: integer(0) }),
      });
    await pact.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/v2/alojamientos/categorias`, { headers: { Accept: 'application/json' } });
      expect(r.status).toBe(200);
      expect(Array.isArray(await r.json())).toBe(true);
    });
  });

  it('orders/create sin Idempotency-Key: error RFC 7807 (el consumidor lo sabe manejar)', async () => {
    pact
      .uponReceiving('crear orden sin Idempotency-Key')
      .withRequest({
        method: 'POST',
        path: '/api/v2/alojamientos/orders/create',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': like('llave-de-prueba') },
        body: {},
      })
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
        body: { type: like('https://booking-prototipo.ec/problemas/validation-failed'), status: 400, code: like('VALIDATION_FAILED') },
      });
    await pact.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/v2/alojamientos/orders/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'llave-de-prueba' },
        body: '{}',
      });
      expect(r.status).toBe(400);
    });
  });

  it('clientes: consultar sin criterios es un error de validación', async () => {
    pact
      .uponReceiving('consulta de huésped sin email ni identificación')
      .withRequest({ method: 'GET', path: '/api/v2/clientes', headers: { Accept: 'application/json' } })
      .willRespondWith({
        status: 400,
        headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
        body: { status: 400, code: 'VALIDATION_FAILED' },
      });
    await pact.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/v2/clientes`, { headers: { Accept: 'application/json' } });
      expect(r.status).toBe(400);
    });
  });

  it('clientes: huésped que no existe responde 404', async () => {
    pact
      .given('no existe el huésped')
      .uponReceiving('consulta de un huésped inexistente')
      .withRequest({ method: 'GET', path: '/api/v2/clientes', query: { identificacion: 'NOEXISTE0001' }, headers: { Accept: 'application/json' } })
      .willRespondWith({
        status: 404,
        headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
        body: { status: 404, code: 'NOT_FOUND' },
      });
    await pact.executeTest(async (mock) => {
      const r = await fetch(`${mock.url}/api/v2/clientes?identificacion=NOEXISTE0001`, { headers: { Accept: 'application/json' } });
      expect(r.status).toBe(404);
    });
  });
});
