import { Consulta } from '../../database/db.service';
import { asignarHabitacion, ESTADOS_EDITABLES, etiquetaDeUnidad, etiquetaHabitacion, pasarAPreparacion } from './habitaciones';

const UNIDAD = '22222222-2222-4222-8222-222222222222';
const RESERVA = '11111111-1111-4111-8111-111111111111';

/** Consulta falsa: responde según un guion de fragmentos de SQL y guarda lo que se ejecutó. */
function falsa(guion: [RegExp, unknown[]][]): { q: Consulta; sqls: string[] } {
  const sqls: string[] = [];
  const q = (async (sql: string) => {
    sqls.push(sql);
    for (const [re, filas] of guion) if (re.test(sql)) return filas;
    return [];
  }) as Consulta;
  return { q, sqls };
}

describe('habitaciones: asignar en el check-in', () => {
  it('un tipo sin unidades físicas registradas no asigna nada', async () => {
    const { q, sqls } = falsa([[/count\(\*\)::int AS n FROM habitacion/, [{ n: 0 }]]]);
    expect(await asignarHabitacion(q, RESERVA, UNIDAD)).toEqual({ tipo: 'NO_HOTEL' });
    expect(sqls.some((s) => /UPDATE habitacion/.test(s))).toBe(false);
  });

  it('sin elegir, ocupa la primera libre y la vincula a la orden', async () => {
    const { q, sqls } = falsa([
      [/count\(\*\)::int AS n FROM habitacion/, [{ n: 5 }]],
      [/UPDATE habitacion SET estado = 'OCUPADA'/, [{ id: 'h1', numero: '109' }]],
    ]);
    expect(await asignarHabitacion(q, RESERVA, UNIDAD)).toEqual({ tipo: 'ASIGNADA', id: 'h1', numero: '109' });
    expect(sqls.some((s) => /SKIP LOCKED/.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE orden_v2 SET habitacion_id/.test(s))).toBe(true);
  });

  it('sin habitaciones libres avisa SIN_DISPONIBLES y no toca la orden', async () => {
    const { q, sqls } = falsa([[/count\(\*\)::int AS n FROM habitacion/, [{ n: 5 }]]]);
    expect(await asignarHabitacion(q, RESERVA, UNIDAD)).toEqual({ tipo: 'SIN_DISPONIBLES' });
    expect(sqls.some((s) => /UPDATE orden_v2/.test(s))).toBe(false);
  });

  it('una habitación elegida que ya no está libre (o es de otro tipo) es NO_VALIDA', async () => {
    const { q } = falsa([[/count\(\*\)::int AS n FROM habitacion/, [{ n: 5 }]]]);
    expect(await asignarHabitacion(q, RESERVA, UNIDAD, '33333333-3333-4333-8333-333333333333')).toEqual({ tipo: 'NO_VALIDA' });
  });

  it('la habitación elegida se pide por id y por unidad (no se puede tomar una de otro tipo)', async () => {
    const { q, sqls } = falsa([
      [/count\(\*\)::int AS n FROM habitacion/, [{ n: 5 }]],
      [/UPDATE habitacion SET estado = 'OCUPADA'/, [{ id: 'h7', numero: '104' }]],
    ]);
    const r = await asignarHabitacion(q, RESERVA, UNIDAD, '33333333-3333-4333-8333-333333333333');
    expect(r).toEqual({ tipo: 'ASIGNADA', id: 'h7', numero: '104' });
    expect(sqls.find((s) => /UPDATE habitacion/.test(s))).toMatch(/unidad_id = \$2::uuid AND estado = 'DISPONIBLE'/);
  });
});

describe('habitaciones: casas, cabañas y departamentos', () => {
  it('también ocupan una unidad física al hacer check-in', async () => {
    const { q } = falsa([
      [/count\(\*\)::int AS n FROM habitacion/, [{ n: 2 }]],
      [/UPDATE habitacion SET estado = 'OCUPADA'/, [{ id: 'c1', numero: '2' }]],
    ]);
    expect(await asignarHabitacion(q, RESERVA, UNIDAD)).toEqual({ tipo: 'ASIGNADA', id: 'c1', numero: '2' });
    expect(etiquetaHabitacion('Cabaña Familiar', '2')).toBe('Cabaña Familiar 2');
  });
});

describe('habitaciones: check-out y estados', () => {
  it('el check-out deja la habitación EN_PREPARACION y devuelve su número', async () => {
    const { q, sqls } = falsa([[/UPDATE habitacion SET estado = 'EN_PREPARACION'/, [{ numero: '109' }]]]);
    expect(await pasarAPreparacion(q, RESERVA)).toBe('109');
    expect(sqls[0]).toMatch(/SELECT habitacion_id FROM orden_v2/);
  });

  it('una estadía sin habitación real devuelve null', async () => {
    const { q } = falsa([]);
    expect(await pasarAPreparacion(q, RESERVA)).toBeNull();
  });

  it('el dueño solo puede fijar DISPONIBLE o EN_PREPARACION; OCUPADA la pone el check-in', () => {
    expect([...ESTADOS_EDITABLES]).toEqual(['DISPONIBLE', 'EN_PREPARACION']);
  });

  it('la etiqueta mezcla tipo y número y respeta el máximo de 100 caracteres', () => {
    expect(etiquetaHabitacion('Suite Familiar', '109')).toBe('Suite Familiar 109');
    expect(etiquetaHabitacion('x'.repeat(120), '101')).toHaveLength(100);
  });
});

describe('etiquetaDeUnidad: cuándo se numera', () => {
  const conTotal = (total: number, nombre = 'Casa Colón') =>
    falsa([[/AS total, a\.nombre/, [{ total, nombre }]]]).q;

  it('un alojamiento con varias habitaciones las numera', async () => {
    expect(await etiquetaDeUnidad(conTotal(3, 'Prueba Jueves'), UNIDAD, 'Habitación Individual', '101')).toBe('Habitación Individual 101');
  });

  it('un alojamiento de una sola unidad se queda con el nombre del alojamiento', async () => {
    expect(await etiquetaDeUnidad(conTotal(1), UNIDAD, 'Cabaña Familiar', '1')).toBe('Casa Colón');
  });

  it('sin número asignado tampoco se inventa uno', async () => {
    expect(await etiquetaDeUnidad(conTotal(5, 'Hotel X'), UNIDAD, 'Suite', null)).toBe('Hotel X');
  });
});
