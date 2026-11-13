import { ProblemBody, ProblemException } from '../../common/problem/problem';
import { DbService } from '../../database/db.service';
import { AlojamientosV2Service } from './alojamientos-v2.service';

/**
 * El 422 CAPACITY_EXCEEDED debe seguir siendo 422 con el mismo code y el mismo detail,
 * pero ahora lleva capacidad máxima, ocupantes pedidos y alternativas que sí caben.
 */

const ALOJ = { id: 'a1b2', codigo: 1001, nombre: 'Hotel Prueba', politica_id: 1, hora_checkin: '14:00:00', noches_min: 1, noches_max: 30 };
const UNIDAD_SIMPLE = { id: 'u-simple', nombre: 'Habitación simple', codigo_tipo: 'SIMPLE', capacidad_huespedes: 1 };

const NOCHES = [
  { fecha: '2030-01-10', precio: '80.00', iva: '15.00' },
  { fecha: '2030-01-11', precio: '80.00', iva: '15.00' },
];

interface Alternativa {
  id: string;
  nombre: string;
  codigo_tipo: string;
  capacidad_huespedes: number;
  cupo: number;
}

function servicio(alternativas: Alternativa[]): AlojamientosV2Service {
  const db = {
    uno: async (sql: string): Promise<unknown> => {
      if (sql.includes('FROM alojamiento WHERE')) return ALOJ;
      if (sql.includes('FROM unidad_alojamiento WHERE alojamiento_id')) return UNIDAD_SIMPLE;
      if (sql.includes('SELECT fn_cupo_unidad($1')) return { n: 5 };
      if (sql.includes('INSERT INTO cotizacion_v2')) return { id: 'cot-1', valida_hasta: '2030-01-09T10:30:00-05:00' };
      return null;
    },
    query: async (sql: string): Promise<unknown[]> => {
      if (sql.includes('CROSS JOIN generate_series')) return NOCHES;
      if (sql.includes('fn_cupo_unidad(id,')) return alternativas;
      return [];
    },
  };
  return new AlojamientosV2Service(db as unknown as DbService);
}

function peticion(adultos: number): Record<string, unknown> {
  return {
    alojamientoId: 'HTL-1001',
    tipoHabitacionCodigo: 'SIMPLE',
    fechaInicio: '2030-01-10',
    fechaFin: '2030-01-12',
    cantidadHabitaciones: 1,
    ocupantes: { adultos, ninos: 0 },
  };
}

async function capturar(adultos: number, alternativas: Alternativa[]): Promise<ProblemBody> {
  try {
    await servicio(alternativas).disponibilidad(peticion(adultos));
  } catch (e) {
    expect(e).toBeInstanceOf(ProblemException);
    expect((e as ProblemException).getStatus()).toBe(422);
    return (e as ProblemException).getResponse() as ProblemBody;
  }
  throw new Error('se esperaba un 422 CAPACITY_EXCEEDED');
}

describe('422 CAPACITY_EXCEEDED con datos útiles', () => {
  it('2 adultos en una unidad de capacidad 1: mismo code y detail, más los 4 campos nuevos', async () => {
    const cuerpo = await capturar(2, [{ id: 'u-doble', nombre: 'Habitación doble', codigo_tipo: 'DOBLE', capacidad_huespedes: 2, cupo: 3 }]);
    expect(cuerpo.status).toBe(422);
    expect(cuerpo.code).toBe('CAPACITY_EXCEEDED');
    expect(cuerpo.detail).toBe('SIMPLE admite 1 huésped(es) por habitación (1 en total).');
    expect(cuerpo.extras).toEqual({
      capacidadMaximaPorHabitacion: 1,
      ocupantesSolicitados: { adultos: 2, ninos: 0 },
      tipoHabitacionCodigo: 'SIMPLE',
      alternativas: [
        {
          tipoHabitacionCodigo: 'DOBLE',
          nombre: 'Habitación doble',
          capacidadAdultos: 2,
          habitacionesRemanentes: 3,
          precioNoche: '80.00',
          precioTotalEstancia: '160.00',
        },
      ],
    });
  });

  it('las alternativas van de la más barata a la más cara', async () => {
    const cuerpo = await capturar(2, [
      { id: 'u-suite', nombre: 'Suite', codigo_tipo: 'SUITE', capacidad_huespedes: 4, cupo: 1 },
      { id: 'u-doble', nombre: 'Habitación doble', codigo_tipo: 'DOBLE', capacidad_huespedes: 2, cupo: 3 },
    ]);
    const lista = (cuerpo.extras as { alternativas: { tipoHabitacionCodigo: string }[] }).alternativas;
    expect(lista).toHaveLength(2);
    // Ambas cuestan lo mismo en este mock: el orden de la consulta (precio_noche_base) se conserva.
    expect(lista.map((a) => a.tipoHabitacionCodigo)).toEqual(['SUITE', 'DOBLE']);
  });

  it('si ninguna otra unidad cabe, alternativas es una lista vacía', async () => {
    const cuerpo = await capturar(2, []);
    expect(cuerpo.code).toBe('CAPACITY_EXCEEDED');
    expect((cuerpo.extras as { alternativas: unknown[] }).alternativas).toEqual([]);
  });

  it('1 adulto en la misma unidad no lanza el error', async () => {
    const r = await servicio([]).disponibilidad(peticion(1));
    expect(r.estaDisponible).toBe(true);
    expect(r.tipoHabitacionCodigo).toBe('SIMPLE');
  });
});
