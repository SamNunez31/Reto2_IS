import { Injectable } from '@nestjs/common';
import { UsuarioToken } from '../../common/auth/decorators';
import { Listado } from '../../common/http/respuestas';
import { conflicto, invalido, noEncontrado } from '../../common/problem/problem';
import { problemaResena } from '../../common/validation/texto-libre';
import { DbService } from '../../database/db.service';
import { OrderDetail } from '../alojamientos/dto/respuestas.dto';
import { FilaOrden, OrdenesService, SQL_ORDEN, sqlPago } from '../alojamientos/services/ordenes.service';
import { ActualizarPerfilDto, CrearResenaDto } from './dto/cuenta.dto';

export interface Perfil {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  razon_social: string | null;
  rol: string;
  es_anfitrion: boolean;
  created_at: string;
}

export interface MiOrden extends OrderDetail {
  estado_interno: string;
  portada: string | null;
  tiene_resena: boolean;
  /** TARJETA | EFECTIVO */
  metodo_pago: string | null;
  /** PENDIENTE (efectivo aún no recibido) | APROBADO */
  estado_pago: string | null;
}

export interface Liquidacion {
  order_id: string;
  simulada: boolean;
  horas_anticipacion: number;
  porcentaje_aplicado: number;
  penalty: number;
  refund: number;
  currency: string;
}

export interface EventoTraza {
  evento_id: number;
  tipo: string;
  agregado: string;
  created_at: string;
  publicado_en: string | null;
  payload: Record<string, unknown>;
}

/** Columnas de `usuario` que el propio usuario puede cambiar (lista blanca para el UPDATE dinámico). */
const COLUMNAS_PERFIL: readonly string[] = ['nombres', 'apellidos', 'telefono', 'tipo_documento', 'numero_documento', 'razon_social'];

const SQL_PERFIL = `
  SELECT u.id, u.email, u.nombres, u.apellidos, u.telefono, u.tipo_documento::text AS tipo_documento, u.numero_documento,
         u.razon_social, u.rol::text AS rol, EXISTS (SELECT 1 FROM alojamiento a WHERE a.anfitrion_id = u.id) AS es_anfitrion,
         u.created_at
    FROM usuario u WHERE u.id = $1`;

@Injectable()
export class CuentaService {
  constructor(
    private readonly db: DbService,
    private readonly ordenes: OrdenesService,
  ) {}

  async perfil(id: string): Promise<Perfil> {
    const p = await this.db.uno<Perfil>(SQL_PERFIL, [id]);
    if (!p) throw noEncontrado('El usuario no existe');
    return p;
  }

  async actualizarPerfil(id: string, dto: ActualizarPerfilDto): Promise<Perfil> {
    const campos = Object.entries(dto).filter(([k, v]) => v !== undefined && COLUMNAS_PERFIL.includes(k));
    if (campos.length) {
      // Los nombres de columna salen de una lista blanca fija (COLUMNAS_PERFIL), los valores van parametrizados
      const sets = campos.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      await this.db.query(`UPDATE usuario SET ${sets} WHERE id = $1`, [id, ...campos.map(([, v]) => v)]);
    }
    return this.perfil(id);
  }

  /** Mis reservas (v_orden), más recientes primero. */
  async misOrdenes(ownerId: string, limit: number, offset: number): Promise<Listado<MiOrden>> {
    const filas = await this.db.query<FilaOrden & Pick<MiOrden, 'portada' | 'tiene_resena' | 'metodo_pago' | 'estado_pago'> & { total: number }>(
      `SELECT x.*, r.portada, EXISTS (SELECT 1 FROM resena rs WHERE rs.reserva_id = x.order_id) AS tiene_resena,
              ${sqlPago('x.order_id')}, count(*) OVER()::int AS total
         FROM (${SQL_ORDEN} WHERE o.owner_id = $1) x
         JOIN alojamiento a ON a.codigo = x.accommodation_id
         JOIN v_alojamiento_resumen r ON r.id = a.id
        ORDER BY x.creation_date DESC LIMIT $2 OFFSET $3`,
      [ownerId, limit, offset],
    );
    return {
      items: filas.map((f) => ({
        ...this.ordenes.aDetalle(f), estado_interno: f.estado_interno, portada: f.portada, tiene_resena: f.tiene_resena,
        metodo_pago: f.metodo_pago, estado_pago: f.estado_pago,
      })),
      total: filas[0]?.total ?? 0,
      limit,
      offset,
    };
  }

  /** Quién es el usuario respecto de la reserva: huésped, anfitrión o admin. Ajena -> 404. */
  async verificarAcceso(reservaId: string, user: UsuarioToken, permitidos: ('huesped' | 'anfitrion' | 'admin')[]): Promise<void> {
    const r = await this.db.uno<{ huesped_id: string; anfitrion_id: string }>(
      `SELECT r.huesped_id, a.anfitrion_id FROM reserva r JOIN alojamiento a ON a.id = r.alojamiento_id WHERE r.id = $1`,
      [reservaId],
    );
    const ok =
      !!r &&
      ((permitidos.includes('huesped') && r.huesped_id === user.sub) ||
        (permitidos.includes('anfitrion') && r.anfitrion_id === user.sub) ||
        (permitidos.includes('admin') && user.rol === 'ADMIN'));
    if (!ok) throw noEncontrado('La reserva no existe');
  }

  /** Factura simulada (v_factura). */
  async factura(reservaId: string, user: UsuarioToken): Promise<Record<string, unknown>> {
    await this.verificarAcceso(reservaId, user, ['huesped', 'anfitrion', 'admin']);
    const f = await this.db.uno<Record<string, unknown>>(
      `SELECT vf.* FROM v_factura vf JOIN factura f ON f.id = vf.id WHERE f.reserva_id = $1`,
      [reservaId],
    );
    if (!f) throw noEncontrado('La reserva aún no tiene factura (se emite al confirmarse)');
    return f;
  }

  /** Línea de tiempo de eventos (v_trazabilidad_reserva: correlacion_id = id de la reserva). */
  timeline(reservaId: string, user: UsuarioToken): Promise<EventoTraza[]> {
    return this.verificarAcceso(reservaId, user, ['huesped', 'anfitrion', 'admin']).then(() =>
      this.db.query<EventoTraza>(
        `SELECT evento_id, tipo, agregado, created_at, publicado_en, payload
           FROM v_trazabilidad_reserva WHERE correlacion_id = $1 ORDER BY evento_id`,
        [reservaId],
      ),
    );
  }

  /**
   * Previsualiza penalidad y reembolso SIN cancelar: ejecuta fn_cancelar_reserva dentro de una
   * transacción que siempre se deshace (así no se reimplementa la regla). Si ya está cancelada, lee la vista.
   */
  async previsualizarCancelacion(reservaId: string, user: UsuarioToken): Promise<Liquidacion> {
    await this.verificarAcceso(reservaId, user, ['huesped']);
    const leer = `SELECT horas_anticipacion, porcentaje_aplicado, penalidad, reembolso FROM v_cancelacion_liquidacion WHERE reserva_id = $1`;
    type FilaLiq = { horas_anticipacion: number; porcentaje_aplicado: number; penalidad: number; reembolso: number };
    let fila = await this.db.uno<FilaLiq>(leer, [reservaId]);
    let simulada = false;
    if (!fila) {
      simulada = true;
      fila = await this.db.simular(async (q) => {
        await q(`SELECT * FROM fn_cancelar_reserva($1, $2, 'simulación')`, [reservaId, user.sub]);
        return (await q<FilaLiq>(leer, [reservaId]))[0];
      });
    }
    return {
      order_id: reservaId,
      simulada,
      horas_anticipacion: fila.horas_anticipacion,
      porcentaje_aplicado: fila.porcentaje_aplicado,
      penalty: fila.penalidad,
      refund: fila.reembolso,
      currency: 'USD',
    };
  }

  /**
   * Reseña del huésped de una estancia COMPLETADA, una sola por reserva (también lo exigen el trigger y uq_resena_reserva).
   * El comentario pasa el control automático de texto_libre (sin revisión humana).
   */
  async crearResena(reservaId: string, dto: CrearResenaDto, user: UsuarioToken): Promise<{ id: string }> {
    await this.verificarAcceso(reservaId, user, ['huesped']);
    const r = await this.db.uno<{ estado: string; ya: boolean }>(
      `SELECT r.estado::text AS estado, EXISTS (SELECT 1 FROM resena rs WHERE rs.reserva_id = r.id) AS ya FROM reserva r WHERE r.id = $1`,
      [reservaId],
    );
    if (r?.estado !== 'COMPLETADA') throw invalido('Solo puedes reseñar una estancia completada', [{ name: 'order_id', reason: 'la estancia no está completada' }]);
    if (r.ya) throw conflicto('Ya reseñaste esta estancia');
    if (dto.comentario) {
      const motivo = problemaResena(dto.comentario);
      if (motivo) throw invalido(motivo, [{ name: 'comentario', reason: motivo }]);
    }
    const fila = await this.db.uno<{ id: string }>(
      `INSERT INTO resena (reserva_id, nota_global, comentario) VALUES ($1, $2, $3) RETURNING id`,
      [reservaId, dto.nota_global, dto.comentario || null],
    );
    return { id: fila?.id as string };
  }
}
