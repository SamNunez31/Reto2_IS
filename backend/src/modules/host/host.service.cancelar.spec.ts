import { DbService } from '../../database/db.service';
import { HostService } from './host.service';

const ADMIN = { sub: 'admin-1', rol: 'ADMIN' } as never;
const ID = '11111111-1111-4111-8111-111111111111';

/** HostService con BD falsa: `reserva()` y la transacción se guionizan. */
function crear(opts: { estado: string; checkin?: string | null; booking?: boolean }): { svc: HostService; sqls: string[] } {
  const sqls: string[] = [];
  const fila = { id: ID, codigo: 'BK-1', estado: opts.estado, canal_booking: !!opts.booking, anfitrion_id: 'x' };
  const q = jest.fn(async (s: string) => {
    sqls.push(s);
    if (/FROM reserva r LEFT JOIN orden_v2/.test(s)) return [{ estado: opts.estado, checkin_en: opts.checkin ?? null }];
    if (/fn_cancelar_reserva/.test(s)) return [{ penalidad: 0, reembolso: 144.9 }];
    return [];
  });
  const db = {
    uno: async () => fila,
    query: q,
    transaccion: async (f: (qq: typeof q) => Promise<unknown>) => f(q),
  } as unknown as DbService;
  return { svc: new HostService(db, {} as never), sqls };
}

describe('HostService.cancelar (admin)', () => {
  it('cancela una reserva confirmada con penalidad 0 y reembolso completo', async () => {
    const { svc, sqls } = crear({ estado: 'CONFIRMADA' });
    const r = await svc.cancelar(ID, 'Pedido del huésped', ADMIN);
    expect(r.penalidad).toBe(0);
    expect(r.reembolso).toBe(144.9);
    expect(sqls.some((s) => /fn_cancelar_reserva/.test(s))).toBe(true);
  });
  it.each(['CANCELADA', 'COMPLETADA', 'EXPIRADA'])('rechaza (409) una reserva %s', async (estado) => {
    const { svc } = crear({ estado });
    await expect(svc.cancelar(ID, undefined, ADMIN)).rejects.toMatchObject({ status: 409 });
  });
  it('rechaza (409) si el huésped ya llegó', async () => {
    const { svc } = crear({ estado: 'CONFIRMADA', checkin: '2026-11-22T15:00:00Z' });
    await expect(svc.cancelar(ID, undefined, ADMIN)).rejects.toMatchObject({ status: 409 });
  });
  it('rechaza (409) una reserva del canal Booking', async () => {
    const { svc } = crear({ estado: 'CONFIRMADA', booking: true });
    await expect(svc.cancelar(ID, undefined, ADMIN)).rejects.toMatchObject({ status: 409 });
  });
  it('rechaza (400) un motivo que no es texto o pasa de 300', async () => {
    const { svc } = crear({ estado: 'CONFIRMADA' });
    await expect(svc.cancelar(ID, 'x'.repeat(301), ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.cancelar(ID, 123, ADMIN)).rejects.toMatchObject({ status: 400 });
  });
});
