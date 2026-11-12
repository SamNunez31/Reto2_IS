import { DbService } from '../../database/db.service';
import { HostService } from './host.service';

const ADMIN = { sub: 'admin-1', rol: 'ADMIN', email: 'admin@posada.ec' } as never;
const ID = '11111111-1111-4111-8111-111111111111';
const HAB = '44444444-4444-4444-8444-444444444444';
const UNIDAD = '22222222-2222-4222-8222-222222222222';

interface Opciones {
  estado?: string;
  /** El tipo es Hotel (solo en hoteles se elige la habitación) */
  hotel?: boolean;
  /** El tipo tiene unidades físicas registradas (hoteles, casas, cabañas…) */
  conHabitaciones?: boolean;
  libres?: { id: string; numero: string }[];
  checkinEn?: string | null;
  checkoutEn?: string | null;
  recepcion?: boolean;
  estadoHabitacion?: string;
  /** Capacidad total de la unidad reservada */
  aforo?: number;
  /** La reserva no trae habitación fijada (reservas anteriores a la mejora) */
  sinAsignar?: boolean;
  /** Unidades físicas del alojamiento: con una sola no se numera */
  unidadesDelAlojamiento?: number;
  /** Huéspedes que figuran en la reserva */
  reservados?: number;
}

/** HostService con BD y notificadores falsos; `sqls` guarda todo lo ejecutado. */
function crear(o: Opciones = {}): { svc: HostService; sqls: string[]; avisos: string[] } {
  const sqls: string[] = [];
  const avisos: string[] = [];
  const reserva = {
    id: ID, codigo: 'BK-079C37F1', estado: o.estado ?? 'CONFIRMADA', canal_booking: true, anfitrion_id: 'x',
    num_huespedes: o.reservados ?? 2, habitacion_asignada: 'Habitación Individual 101',
    fecha_entrada: '2026-11-11', fecha_salida: '2026-11-13',
  };
  const libres = o.libres ?? [{ id: HAB, numero: '109' }];
  const guion = async (sql: string): Promise<unknown[]> => {
    sqls.push(sql);
    if (/t\.nombre = 'Hotel'/.test(sql)) return [{ es: o.hotel ?? true }];
    if (/count\(\*\)::int AS n FROM habitacion/.test(sql)) return [{ n: (o.conHabitaciones ?? true) ? 3 : 0 }];
    if (/AS total, a\.nombre/.test(sql)) return [{ total: o.unidadesDelAlojamiento ?? 3, nombre: 'Prueba Jueves' }];
    // Ocupar la habitación ya fijada en la reserva (va antes que la asignación genérica)
    if (/UPDATE habitacion SET estado = 'OCUPADA'[\s\S]*habitacion_id FROM orden_v2/.test(sql)) return o.sinAsignar ? [] : [{ numero: '109' }];
    if (/UPDATE habitacion SET estado = 'OCUPADA'[\s\S]*unidad_id = \$2::uuid AND estado = 'DISPONIBLE'/.test(sql)) return libres.length ? [{ numero: '109' }] : [];
    if (/UPDATE habitacion SET estado = 'OCUPADA'/.test(sql)) return libres.slice(0, 1);
    if (/UPDATE habitacion SET estado = 'EN_PREPARACION'/.test(sql)) return [{ numero: '109' }];
    if (/FROM habitacion WHERE unidad_id = \$1::uuid AND estado = 'DISPONIBLE'/.test(sql)) return libres;
    if (/h\.estado = 'DISPONIBLE' AND \(\$4::uuid IS NULL/.test(sql)) return [{ id: 'h2', numero: '110' }];
    if (/FROM unidad_alojamiento u/.test(sql) && /fn_cupo_unidad/.test(sql)) {
      return [{ codigo_tipo: 'HABITACION_DOBLE', nombre: 'Habitación doble', capacidad: 2, precio_noche: 100, libres: 1 }];
    }
    return [];
  };
  const db = {
    uno: async (sql: string) => {
      sqls.push(sql);
      if (/SELECT x\.\* FROM/.test(sql)) return reserva;
      if (/FROM orden_v2 o JOIN unidad_alojamiento u/.test(sql)) return { checkin_en: o.checkinEn ?? null, recepcion: o.recepcion ?? false, habitacion: null, unidad: 'Suite Familiar', unidad_id: UNIDAD, aforo: o.aforo ?? 4 };
      if (/SELECT o\.checkin_en, o\.checkout_en/.test(sql)) return { checkin_en: o.checkinEn === undefined ? '2026-11-11T01:27:00Z' : o.checkinEn, checkout_en: o.checkoutEn ?? null };
      if (/o\.unidad_id::text AS unidad_id/.test(sql)) return { unidad_id: UNIDAD, alojamiento_codigo: 1033 };
      if (/SELECT a\.id FROM alojamiento a/.test(sql)) return { id: 'aloj-1' };
      if (/SELECT estado::text AS estado FROM habitacion/.test(sql)) return { estado: o.estadoHabitacion ?? 'EN_PREPARACION' };
      return null;
    },
    query: guion,
    transaccion: async (f: (q: typeof guion) => Promise<unknown>) => f(guion),
  } as unknown as DbService;
  const aviso = (n: string) => ({ notificar: async () => { avisos.push(n); return true; }, reintentarPendientes: async () => 0 });
  return { svc: new HostService(db, aviso('checkin') as never, aviso('checkout') as never), sqls, avisos };
}

describe('HostService.registrarLlegada: habitación real', () => {
  it('en un hotel ocupa una habitación y la muestra con su número', async () => {
    const { svc, sqls } = crear();
    const r = await svc.registrarLlegada(ID, { huespedes_reales: 2 }, ADMIN);
    expect(r.habitacion_asignada).toBe('Suite Familiar 109');
    expect(sqls.some((s) => /UPDATE habitacion SET estado = 'OCUPADA'/.test(s))).toBe(true);
  });

  it('ocupa la habitación que ya traía la reserva, sin elegir ninguna', async () => {
    const { svc, sqls } = crear();
    await svc.registrarLlegada(ID, {}, ADMIN);
    expect(sqls.find((s) => /UPDATE habitacion SET estado = 'OCUPADA'/.test(s))).toMatch(/habitacion_id FROM orden_v2/);
  });

  it('una reserva antigua sin habitación fijada toma la primera libre', async () => {
    const { svc, sqls } = crear({ sinAsignar: true });
    const r = await svc.registrarLlegada(ID, {}, ADMIN);
    expect(r.habitacion_asignada).toBe('Suite Familiar 109');
    expect(sqls.some((s) => /SKIP LOCKED/.test(s))).toBe(true);
  });

  it('una casa de una sola unidad se identifica con el nombre del alojamiento, sin número', async () => {
    const { svc, sqls } = crear({ hotel: false, unidadesDelAlojamiento: 1 });
    const r = await svc.registrarLlegada(ID, {}, ADMIN);
    expect(r.habitacion_asignada).toBe('Prueba Jueves');
    expect(sqls.some((s) => /UPDATE habitacion SET estado = 'OCUPADA'/.test(s))).toBe(true);
  });

  it('un tipo sin unidades registradas conserva el nombre del tipo', async () => {
    const { svc } = crear({ hotel: false, conHabitaciones: false, sinAsignar: true });
    expect((await svc.registrarLlegada(ID, {}, ADMIN)).habitacion_asignada).toBe('Suite Familiar');
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

describe('HostService.registrarLlegada: llegaron más huéspedes de los reservados', () => {
  it('con los reservados no hay extra', async () => {
    const r = await crear({ reservados: 2, aforo: 4 }).svc.registrarLlegada(ID, { huespedes_reales: 2 }, ADMIN);
    expect(r.huespedes_extra).toBe(0);
    expect(r.aforo_maximo).toBe(4);
  });

  it('por encima de lo reservado pero dentro del aforo: se admite y se informa el extra', async () => {
    const { svc, sqls } = crear({ reservados: 2, aforo: 4 });
    const r = await svc.registrarLlegada(ID, { huespedes_reales: 3 }, ADMIN);
    expect(r.huespedes_extra).toBe(1);
    expect(sqls.some((s) => /checkin_huespedes = \$5/.test(s))).toBe(true);
  });

  it('por encima del aforo no se bloquea la llegada: se registra y se informa el excedente', async () => {
    const { svc, sqls } = crear({ reservados: 2, aforo: 4 });
    const r = await svc.registrarLlegada(ID, { huespedes_reales: 5 }, ADMIN);
    expect(r.huespedes_extra).toBe(3);
    expect(sqls.some((s) => /checkin_recepcion = true/.test(s))).toBe(true);
  });

  it('sin indicar cuántos llegaron se toman los reservados', async () => {
    expect((await crear({ reservados: 3, aforo: 4 }).svc.registrarLlegada(ID, {}, ADMIN)).huespedes_extra).toBe(0);
  });
});

describe('HostService.sincronizarBooking', () => {
  it('reintenta los avisos pendientes de check-in y de check-out', async () => {
    const svc = crear().svc;
    expect(await svc.sincronizarBooking(ADMIN)).toEqual({ checkin: 0, checkout: 0 });
  });

  it('solo el administrador puede lanzarlo', async () => {
    await expect(crear().svc.sincronizarBooking({ sub: 'u1', rol: 'USUARIO' } as never)).rejects.toMatchObject({ status: 409 });
  });
});

describe('HostService.registrarLlegada: cambio excepcional de habitación', () => {
  it('cambia a otra habitación del mismo tipo dejando el motivo registrado', async () => {
    const { svc, sqls } = crear();
    const r = await svc.registrarLlegada(ID, { habitacion_id: HAB, motivo_cambio: 'Aire acondicionado averiado' }, ADMIN);
    expect(r.habitacion_asignada).toBe('Suite Familiar 109');
    expect(sqls.some((s) => /unidad_id = \$2::uuid AND estado = 'DISPONIBLE'/.test(s))).toBe(true);
    const guardado = sqls.find((s) => /checkin_recepcion = true/.test(s));
    expect(guardado).toBeDefined();
  });

  it('sin motivo no se permite el cambio (400)', async () => {
    const { svc } = crear();
    await expect(svc.registrarLlegada(ID, { habitacion_id: HAB }, ADMIN)).rejects.toMatchObject({ status: 400 });
    await expect(svc.registrarLlegada(ID, { habitacion_id: HAB, motivo_cambio: '  ' }, ADMIN)).rejects.toMatchObject({ status: 400 });
  });

  it('si esa habitación ya no está libre responde 409', async () => {
    const { svc } = crear({ libres: [] });
    await expect(svc.registrarLlegada(ID, { habitacion_id: HAB, motivo_cambio: 'Avería' }, ADMIN)).rejects.toMatchObject({ status: 409 });
  });
});

describe('HostService.datosParaCheckin', () => {
  it('devuelve la habitación ya fijada en la reserva, sin pedir que se elija ninguna', async () => {
    const { svc } = crear();
    const r = await svc.datosParaCheckin(ID, ADMIN);
    expect(r.habitacion_asignada).toBe('Habitación Individual 101');
    expect(r.es_hotel).toBe(true);
  });

  it('con una sola unidad no numera y no ofrece cambio de habitación', async () => {
    const { svc } = crear({ unidadesDelAlojamiento: 1 });
    const r = await svc.datosParaCheckin(ID, ADMIN);
    expect(r.numerada).toBe(false);
    expect(r.habitaciones_libres).toEqual([]);
  });

  it('en un hotel ofrece las otras habitaciones libres del mismo tipo', async () => {
    const { svc } = crear();
    const r = await svc.datosParaCheckin(ID, ADMIN);
    expect(r.numerada).toBe(true);
    expect(r.habitaciones_libres.map((h) => h.numero)).toEqual(['110']);
  });

  it('sugiere los tipos que siguen libres esas fechas, para reservar a los huéspedes de más', async () => {
    const { svc, sqls } = crear();
    const r = await svc.datosParaCheckin(ID, ADMIN);
    expect(r.sugerencias.map((s) => s.nombre)).toEqual(['Habitación doble']);
    expect(sqls.some((s) => /fn_cupo_unidad\(u\.id/.test(s) && /u\.id <> \$4::uuid/.test(s))).toBe(true);
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
