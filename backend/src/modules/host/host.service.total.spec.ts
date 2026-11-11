import { DbService } from '../../database/db.service';
import { HostService } from './host.service';

const ADMIN = { sub: 'admin-1', rol: 'ADMIN' } as never;

/** HostService con BD falsa: guarda el SQL que se ejecuta. */
function crear(): { svc: HostService; sqls: string[] } {
  const sqls: string[] = [];
  const db = {
    query: async (s: string) => {
      sqls.push(s);
      return [{ id: 'r1', codigo: 'BK-079C37F1', total: '119.00', total_filas: 1, anfitrion_id: 'x' }];
    },
  } as unknown as DbService;
  return { svc: new HostService(db, {} as never, {} as never), sqls };
}

describe('HostService.reservas: total mostrado en el panel', () => {
  it('usa el total de la orden de Booking (con tasa municipal) y cae a v_reserva_total si no hay orden', async () => {
    const { svc, sqls } = crear();
    await svc.reservas(ADMIN, { limit: 20, offset: 0 } as never);
    expect(sqls[0]).toMatch(/COALESCE\(o\.total, t\.total\) AS total/);
  });

  it('trae el titular real de Booking (nombre y documento) para el check-in', async () => {
    const { svc, sqls } = crear();
    await svc.reservas(ADMIN, { limit: 20, offset: 0 } as never);
    expect(sqls[0]).toMatch(/o\.titular->>'identificacion' AS titular_identificacion/);
    expect(sqls[0]).toMatch(/o\.titular->>'nombreCompleto' AS titular_nombre/);
  });

  it('devuelve las filas sin las columnas internas', async () => {
    const { svc } = crear();
    const r = await svc.reservas(ADMIN, { limit: 20, offset: 0 } as never);
    expect(r.items[0]).toEqual({ id: 'r1', codigo: 'BK-079C37F1', total: '119.00' });
    expect(r.total).toBe(1);
  });
});
