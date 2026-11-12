import { DbService } from '../../database/db.service';
import { HostService } from './host.service';

const ADMIN = { sub: 'admin-1', rol: 'ADMIN', email: 'admin@posada.ec' } as never;
const ID = '11111111-1111-4111-8111-111111111111';
const HAB = '44444444-4444-4444-8444-444444444444';
const UNIDAD = '22222222-2222-4222-8222-222222222222';

interface Opciones {
  estado?: string;
  hotel?: boolean;
  libres?: { id: string; numero: string }[];
  checkinEn?: string | null;
  checkoutEn?: string | null;
  recepcion?: boolean;
  estadoHabitacion?: string;
}

/** HostService con BD y notificadores falsos; `sqls` guarda todo lo ejecutado. */
function crear(o: Opciones = {}): { svc: HostService; sqls: string[]; avisos: string[] } {
  const sqls: string[] = [];
  const avisos: string[] = [];
  const reserva = { id: ID, codigo: 'BK-079C37F1', estado: o.estado ?? 'CONFIRMADA', canal_booking: true, anfitrion_id: 'x' };
  const libres = o.libres ?? [{ id: HAB, numero: '109' }];
  const guion = async (sql: string): Promise<unknown[]> => {
    sqls.push(sql);
    if (/t\.nombre = 'Hotel'/.test(sql)) return [{ es: o.hotel ?? true }];
    if (/UPDATE habitacion SET estado = 'OCUPADA'/.test(sql)) return libres.slice(0, 1);
    if (/UPDATE habitacion SET estado = 'EN_PREPARACION'/.test(sql)) return [{ numero: '109' }];
    if (/FROM habitacion WHERE unidad_id = \$1::uuid AND estado = 'DISPONIBLE'/.test(sql)) return libres;
    return [];
  };
  const db = {
    uno: async (sql: string) => {
      sqls.push(sql);
      if (/SELECT x\.\* FROM/.test(sql)) return reserva;
      if (/FROM orden_v2 o JOIN unidad_alojamiento u/.test(sql)) return { checkin_en: o.checkinEn ?? null, recepcion: o.recepcion ?? false, habitacion: null, unidad: 'Suite Familiar', unidad_id: UNIDAD };
      if (/SELECT o\.checkin_en, o\.checkout_en/.test(sql)) return { checkin_en: o.checkinEn === undefined ? '2026-11-11T01:27:00Z' : o.checkinEn, checkout_en: o.checkoutEn ?? null };
      if (/SELECT unidad_id::text AS unidad_id FROM orden_v2/.test(sql)) return { unidad_id: UNIDAD };
      if (/SELECT a\.id FROM alojamiento a/.test(sql)) return { id: 'aloj-1' };
      if (/SELECT estado::text AS estado FROM habitacion/.test(sql)) return { estado: o.estadoHabitacion ?? 'EN_PREPARACION' };
      return null;
    },
    query: guion,
    transaccion: async (f: (q: typeof guion) => Promise<unknown>) => f(guion),
  } as unknown as DbService;
  const aviso = (n: string) => ({ notificar: async () => { avisos.push(n); return true; } });
  return { svc: new HostService(db, aviso('checkin') as never, aviso('checkout') as never), sqls, avisos };
}

describe('HostService.registrarLlegada: habitación real', () => {
  it('en un hotel ocupa una habitación y la muestra con su número', async () => {
    const { svc, sqls } = crear();
    const r = await svc.registrarLlegada(ID, { huespedes_reales: 2 }, ADMIN);
    expect(r.habitacion_asignada).toBe('Suite Familiar 109');
    expect(sqls.some((s) => /UPDATE habitacion SET estado = 'OCUPADA'/.test(s))).toBe(true);
  });

  it('con una habitación elegida pide esa y no la primera libre', async () => {
    const { svc, sqls } = crear();
    await svc.registrarLlegada(ID, { habitacion_id: HAB }, ADMIN);
    expect(sqls.find((s) => /UPDATE habitacion SET estado = 'OCUPADA'/.test(s))).toMatch(/WHERE id = \$1::uuid AND unidad_id/);
  });

  it('sin habitaciones libres responde 409 y no registra la llegada', async () => {
    const { svc, sqls } = crear({ libres: [] });
    await expect(svc.registrarLlegada(ID, {}, ADMIN)).rejects.toMatchObject({ status: 409 });
    expect(sqls.some((s) => /checkin_recepcion = true/.test(s))).toBe(false);
  });

  it('fuera de hoteles no hay número de habitación', async () => {
    const { svc, sqls } = crear({ hotel: false });
    const r = await svc.registrarLlegada(ID, {}, ADMIN);
    expect(r.habitacion_asignada).toBe('Suite Familiar');
    expect(sqls.some((s) => /UPDATE habitacion/.test(s))).toBe(false);
  });

  it('rechaza (400) un habitacion_id que no es UUID', async () => {
    const { svc } = crear();
    await expect(svc.registrarLlegada(ID, { habitacion_id: 'no-es-uuid' }, ADMIN)).rejects.toMatchObject({ status: 400 });
  });

  it('es idempotente: si la recepción ya estaba registrada no vuelve a ocupar habitación', async () => {
    const { svc, sqls } = crear({ recepcion: true, checkinEn: '2026-11-11T01:27:00Z' });
    const r = await svc.registrarLlegada(ID, {}, ADMIN);
    expect(r.ya_registrado).toBe(true);
    expect(sqls.some((s) => /UPDATE habitacion/.test(s))).toBe(false);
  });
});

describe('HostService.habitacionesParaCheckin', () => {
  it('lista las libres del tipo reservado en un hotel', async () => {
    const { svc } = crear({ libres: [{ id: HAB, numero: '109' }, { id: 'h2', numero: '110' }] });
    const r = await svc.habitacionesParaCheckin(ID, ADMIN);
    expect(r.es_hotel).toBe(true);
    expect(r.habitaciones.map((h) => h.numero)).toEqual(['109', '110']);
  });

  it('fuera de hoteles devuelve es_hotel false y lista vacía', async () => {
    const { svc } = crear({ hotel: false });
    expect(await svc.habitacionesParaCheckin(ID, ADMIN)).toEqual({ es_hotel: false, habitaciones: [] });
  });
});

describe('HostService.registrarSalida (check-out)', () => {
  it('completa la reserva, deja la habitación en preparación y avisa a Booking', async () => {
    const { svc, sqls, avisos } = crear({ checkinEn: '2026-11-11T01:27:00Z' });
    const r = await svc.registrarSalida(ID, { observaciones: 'Todo en orden' }, ADMIN);
    expect(r.estado).toBe('CHECKED_OUT');
    expect(r.habitacion_en_preparacion).toBe('109');
    expect(r.ya_registrado).toBe(false);
    expect(sqls.some((s) => /UPDATE reserva SET estado = 'COMPLETADA'/.test(s))).toBe(true);
    expect(sqls.some((s) => /checkout_recepcion = true/.test(s))).toBe(true);
    expect(avisos).toEqual(['checkout']);
  });

  it('cobra los consumos extra (minibar) y devuelve el total', async () => {
    const { svc, sqls } = crear({ checkinEn: '2026-11-11T01:27:00Z' });
    const r = await svc.registrarSalida(
      ID,
      { consumos: [{ item: 'Agua', cantidad: 2, precio: '1.50' }, { item: 'Snack', precio: '2.25' }], metodo_pago_consumos: 'CARGO_A_RESERVA' },
      ADMIN,
    );
    expect(r.consumos_total).toBe('5.25');
    expect(sqls.some((s) => /consumos_total = \$4/.test(s))).toBe(true);
  });

  it('sin consumos el total es 0.00', async () => {
    const { svc } = crear({ checkinEn: '2026-11-11T01:27:00Z' });
    expect((await svc.registrarSalida(ID, {}, ADMIN)).consumos_total).toBe('0.00');
  });

  it('rechaza (400) consumos mal formados o un método de cobro desconocido', async () => {
    const { svc } = crear();
    await expect(svc.registrarSalida(ID, { consumos: [{ item: '', precio: '1.00' }] }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.registrarSalida(ID, { consumos: [{ item: 'x', precio: '1,5' }] }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.registrarSalida(ID, { consumos: [{ item: 'x', cantidad: 0, precio: '1.00' }] }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.registrarSalida(ID, { metodo_pago_consumos: 'BITCOIN' }, ADMIN)).rejects.toMatchObject({ status: 400 });
  });

  it('exige el check-in previo (409)', async () => {
    const { svc } = crear({ checkinEn: null });
    await expect(svc.registrarSalida(ID, {}, ADMIN)).rejects.toMatchObject({ status: 409 });
  });

  it('es idempotente: un segundo check-out no repite cambios', async () => {
    const { svc, sqls } = crear({ checkoutEn: '2026-11-13T15:00:00Z' });
    const r = await svc.registrarSalida(ID, {}, ADMIN);
    expect(r.ya_registrado).toBe(true);
    expect(sqls.some((s) => /UPDATE reserva SET estado/.test(s))).toBe(false);
  });

  it('si el job ya la completó por fecha, igual registra la salida sin tocar el estado', async () => {
    const { svc, sqls } = crear({ estado: 'COMPLETADA' });
    const r = await svc.registrarSalida(ID, {}, ADMIN);
    expect(r.ya_registrado).toBe(false);
    expect(sqls.some((s) => /UPDATE reserva SET estado/.test(s))).toBe(false);
    expect(sqls.some((s) => /EN_PREPARACION/.test(s))).toBe(true);
  });

  it('rechaza (409) una reserva cancelada y (400) observaciones demasiado largas', async () => {
    await expect(crear({ estado: 'CANCELADA' }).svc.registrarSalida(ID, {}, ADMIN)).rejects.toMatchObject({ status: 409 });
    await expect(crear().svc.registrarSalida(ID, { observaciones: 'x'.repeat(301) }, ADMIN)).rejects.toMatchObject({ status: 400 });
  });
});

describe('HostService.cambiarEstadoHabitacion (lo hace el dueño)', () => {
  it('pasa de EN_PREPARACION a DISPONIBLE', async () => {
    const { svc, sqls } = crear({ estadoHabitacion: 'EN_PREPARACION' });
    expect(await svc.cambiarEstadoHabitacion(7, HAB, 'DISPONIBLE', ADMIN)).toEqual({ id: HAB, estado: 'DISPONIBLE' });
    expect(sqls.some((s) => /UPDATE habitacion SET estado = \$2::estado_habitacion/.test(s))).toBe(true);
  });

  it('no se puede cambiar una habitación ocupada (409): se libera con el check-out', async () => {
    const { svc } = crear({ estadoHabitacion: 'OCUPADA' });
    await expect(svc.cambiarEstadoHabitacion(7, HAB, 'DISPONIBLE', ADMIN)).rejects.toMatchObject({ status: 409 });
  });

  it('no se puede fijar OCUPADA a mano ni un estado inventado (400)', async () => {
    const { svc } = crear();
    await expect(svc.cambiarEstadoHabitacion(7, HAB, 'OCUPADA', ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.cambiarEstadoHabitacion(7, HAB, 'ROTA', ADMIN)).rejects.toMatchObject({ status: 400 });
  });

  it('pedir el mismo estado no escribe nada', async () => {
    const { svc, sqls } = crear({ estadoHabitacion: 'DISPONIBLE' });
    await svc.cambiarEstadoHabitacion(7, HAB, 'DISPONIBLE', ADMIN);
    expect(sqls.some((s) => /UPDATE habitacion/.test(s))).toBe(false);
  });
});
