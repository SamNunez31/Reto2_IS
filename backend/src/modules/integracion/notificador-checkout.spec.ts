import { DbService } from '../../database/db.service';
import { NotificadorCheckout, rutaCheckout } from './notificador-checkout';

const ID = '11111111-1111-4111-8111-111111111111';

describe('NotificadorCheckout', () => {
  const entorno = { ...process.env };
  afterEach(() => {
    process.env = { ...entorno };
    jest.restoreAllMocks();
  });

  it('sin CHECKOUT_REST_PATH no hay ruta: el aviso queda pendiente', () => {
    delete process.env.CHECKOUT_REST_PATH;
    expect(rutaCheckout('ORD-HTL-079C37F1')).toBeNull();
  });

  it('con CHECKOUT_REST_PATH sustituye {id} por la orden externa', () => {
    process.env.CHECKOUT_REST_PATH = '/api/v1/reservas/{id}/checkout';
    expect(rutaCheckout('ORD-HTL-079C37F1')).toBe('/api/v1/reservas/ORD-HTL-079C37F1/checkout');
  });

  it('sin ruta configurada no llama a la BD ni a Booking y devuelve false', async () => {
    delete process.env.CHECKOUT_REST_PATH;
    process.env.STOCK_REST_URL = 'https://booking.test';
    process.env.STOCK_REST_API_KEY = 'k';
    const query = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch');
    const n = new NotificadorCheckout({ query, uno: jest.fn() } as unknown as DbService);
    expect(await n.notificar(ID)).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await n.reintentarPendientes()).toBe(0);
  });

  it('con todo configurado envía el check-out y lo marca como notificado', async () => {
    process.env.CHECKOUT_REST_PATH = '/api/v1/reservas/{id}/checkout';
    process.env.STOCK_REST_URL = 'https://booking.test/';
    process.env.STOCK_REST_API_KEY = 'llave';
    const sqls: string[] = [];
    const query = jest.fn(async (s: string) => {
      sqls.push(s);
      return /RETURNING checkout_notif_intentos/.test(s) ? [{ intentos: 1 }] : [];
    });
    const uno = jest.fn(async () => ({ external: 'BK-079C37F1', fecha: '2026-11-13T15:00:00.000Z' }));
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const n = new NotificadorCheckout({ query, uno } as unknown as DbService);
    expect(await n.notificar(ID)).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://booking.test/api/v1/reservas/ORD-HTL-079C37F1/checkout');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'llave' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ external_order_id: 'ORD-HTL-079C37F1', estado: 'CHECKED_OUT', fecha_checkout: '2026-11-13T15:00:00.000Z' });
    expect(sqls.some((s) => /checkout_notificado_en = now\(\)/.test(s))).toBe(true);
  });

  it('un 4xx definitivo no se reintenta; un 5xx sí', async () => {
    process.env.CHECKOUT_REST_PATH = '/x/{id}';
    process.env.STOCK_REST_URL = 'https://booking.test';
    process.env.STOCK_REST_API_KEY = 'k';
    const casos: [number, boolean][] = [[422, true], [503, false]];
    for (const [status, definitivo] of casos) {
      const params: unknown[][] = [];
      const query = jest.fn(async (s: string, p?: unknown[]) => {
        if (/RETURNING checkout_notif_intentos/.test(s)) return [{ intentos: 1 }];
        if (/checkout_notif_error = \$2/.test(s)) params.push(p ?? []);
        return [];
      });
      const uno = jest.fn(async () => ({ external: 'BK-1', fecha: 'f' }));
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('no', { status }));
      expect(await new NotificadorCheckout({ query, uno } as unknown as DbService).notificar(ID)).toBe(false);
      expect(params[0][2]).toBe(definitivo);
    }
  });
});
