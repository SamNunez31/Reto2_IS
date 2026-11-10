import { DbService } from '../../database/db.service';
import { NotificadorCheckin, rutaCheckin } from './notificador-checkin';

describe('NotificadorCheckin', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('la ruta por defecto es la v1 de Booking y se puede cambiar con CHECKIN_REST_PATH', () => {
    delete process.env.CHECKIN_REST_PATH;
    expect(rutaCheckin('ORD-HTL-1')).toBe('/api/v1/reservas/ORD-HTL-1/checkin');
    process.env.CHECKIN_REST_PATH = '/api/v2/reservas/{id}/checkin';
    expect(rutaCheckin('ORD-HTL-1')).toBe('/api/v2/reservas/ORD-HTL-1/checkin');
  });

  it('envía POST con X-API-Key y el cuerpo mínimo (external_order_id, estado, huespedes_reales)', async () => {
    process.env.CHECKIN_REST_URL = 'https://booking.test';
    process.env.CHECKIN_REST_API_KEY = 'clave-de-prueba';
    delete process.env.CHECKIN_REST_PATH;
    const fila = { external: 'BK-ABC123', cliente_id: 'c1', num_huespedes: 2, huespedes: 3, admin: null, observaciones: null, fecha: '2026-11-22T15:00:00.000Z', titular: null };
    const sqls: string[] = [];
    const db = {
      query: async (s: string) => { sqls.push(s); return /UPDATE orden_v2 SET checkin_notif_intentos/.test(s) ? [{ intentos: 1 }] : []; },
      uno: async () => fila,
      transaccion: async () => ({}),
    } as unknown as DbService;
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const ok = await new NotificadorCheckin(db).notificar('11111111-1111-4111-8111-111111111111');

    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://booking.test/api/v1/reservas/ORD-HTL-ABC123/checkin');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'clave-de-prueba', 'content-type': 'application/json' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ external_order_id: 'ORD-HTL-ABC123', estado: 'CONFIRMADO_ASISTIDO', huespedes_reales: 3 });
    expect(sqls.some((s) => /checkin_notificado_en = now\(\)/.test(s))).toBe(true);
  });
});
