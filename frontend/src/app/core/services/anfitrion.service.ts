import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { Listado, RespuestaApi } from '../models/api.models';
import { API } from './api-base';

export interface ResumenAlojamiento {
  codigo: number;
  nombre: string;
  tipo: string;
  ciudad: string;
  provincia: string;
  estado: string;
  modo_reserva: string;
  precio_desde: number | null;
  portada: string | null;
  calificacion: number | null;
  num_resenas: number;
  unidades_activas: number;
}

export interface Unidad {
  id: string;
  nombre: string;
  capacidad_huespedes: number;
  num_habitaciones: number;
  num_camas: number;
  num_banos: number;
  cantidad: number;
  precio_noche_base: number;
  activa: boolean;
}

export interface DatosAlojamiento {
  tipo_id: number;
  ciudad_id: number;
  politica_id: number;
  nombre: string;
  descripcion: string;
  direccion: string;
  latitud: number;
  longitud: number;
  telefono_contacto?: string;
  hora_checkin?: string;
  hora_checkout?: string;
  noches_min?: number;
  noches_max?: number;
  tarifa_limpieza?: number;
  modo_reserva?: 'INSTANTANEA';
  reglas_casa?: string;
  categoria_estrellas?: number;
  amenidades?: number[];
  imagenes?: { url: string; es_portada?: boolean }[];
}

export interface AlojamientoEditable extends DatosAlojamiento {
  codigo: number;
  estado: string;
  unidades: Unidad[];
}

export interface DiaCalendario {
  fecha: string;
  precio_noche: number | null;
  cantidad_a_la_venta: number | null;
  precio_efectivo: number;
  cupo_libre: number;
}

export interface ReservaHost {
  id: string;
  codigo: string;
  estado: string;
  alojamiento: string;
  alojamiento_codigo: number;
  huesped: string;
  fecha_entrada: string;
  fecha_salida: string;
  num_huespedes: number;
  total: number;
  created_at: string;
  /** TARJETA | EFECTIVO */
  metodo_pago: string | null;
  /** PENDIENTE (efectivo aún no recibido) | APROBADO */
  estado_pago: string | null;
  /** true si llegó por Booking (orden v2): solo esas admiten check-in en recepción */
  canal_booking: boolean;
  /** Momento de llegada del huésped; null si aún no llegó */
  checkin_en: string | null;
}

export interface RespuestaLlegada {
  reserva: ReservaHost;
  estado: 'CHECKED_IN';
  habitacion_asignada: string;
  ya_registrado: boolean;
  booking_notificado: boolean;
}

export interface ResenaHost {
  id: string;
  alojamiento: string;
  nota_global: number;
  comentario: string | null;
  respuesta_anfitrion: string | null;
  autor: string;
  created_at: string;
}

const datos = <T>(o: Observable<RespuestaApi<T>>) => o.pipe(map((r) => r.data));

/** Rutas propias host/*: catálogo de Posada EC (solo ADMIN, que opera sobre cualquier alojamiento). */
@Injectable({ providedIn: 'root' })
export class AnfitrionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API}/host`;

  alojamientos(): Observable<ResumenAlojamiento[]> {
    return datos(this.http.get<RespuestaApi<ResumenAlojamiento[]>>(`${this.base}/accommodations`));
  }
  obtener(codigo: number): Observable<AlojamientoEditable> {
    return datos(this.http.get<RespuestaApi<AlojamientoEditable>>(`${this.base}/accommodations/${codigo}`));
  }
  crear(d: DatosAlojamiento): Observable<{ codigo: number }> {
    return datos(this.http.post<RespuestaApi<{ codigo: number }>>(`${this.base}/accommodations`, d));
  }
  actualizar(codigo: number, d: Partial<DatosAlojamiento>): Observable<AlojamientoEditable> {
    return datos(this.http.patch<RespuestaApi<AlojamientoEditable>>(`${this.base}/accommodations/${codigo}`, d));
  }
  publicar(codigo: number, publicar: boolean): Observable<{ estado: string }> {
    return datos(this.http.post<RespuestaApi<{ estado: string }>>(`${this.base}/accommodations/${codigo}/${publicar ? 'publish' : 'unpublish'}`, null));
  }
  crearUnidad(codigo: number, u: Omit<Unidad, 'id' | 'activa'>): Observable<Unidad> {
    return datos(this.http.post<RespuestaApi<Unidad>>(`${this.base}/accommodations/${codigo}/units`, u));
  }
  actualizarUnidad(id: string, u: Partial<Omit<Unidad, 'id'>>): Observable<Unidad> {
    return datos(this.http.patch<RespuestaApi<Unidad>>(`${this.base}/units/${id}`, u));
  }
  calendario(unidad: string, desde: string, hasta: string): Observable<DiaCalendario[]> {
    const params = new HttpParams().set('desde', desde).set('hasta', hasta);
    return datos(this.http.get<RespuestaApi<DiaCalendario[]>>(`${this.base}/units/${unidad}/calendar`, { params }));
  }
  guardarCalendario(unidad: string, dias: { fecha: string; precio_noche: number | null; cantidad_a_la_venta: number | null }[]): Observable<{ dias: number }> {
    return datos(this.http.put<RespuestaApi<{ dias: number }>>(`${this.base}/units/${unidad}/calendar`, { dias }));
  }
  reservas(estado: string, limit: number, offset: number, estadoPago = ''): Observable<Listado<ReservaHost>> {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (estado) params = params.set('estado', estado);
    if (estadoPago) params = params.set('estado_pago', estadoPago);
    return datos(this.http.get<RespuestaApi<Listado<ReservaHost>>>(`${this.base}/orders`, { params }));
  }
  /** Marca como recibido el pago en efectivo de la reserva (idempotente). */
  /** Check-in en recepción: el huésped llegó. El backend avisa a Booking. */
  registrarLlegada(id: string, cuerpo: { observaciones?: string } = {}): Observable<RespuestaLlegada> {
    return datos(this.http.post<RespuestaApi<RespuestaLlegada>>(`${this.base}/orders/${id}/arrival`, cuerpo));
  }

  confirmarPago(id: string): Observable<{ reserva: ReservaHost; ya_confirmado: boolean }> {
    return datos(this.http.post<RespuestaApi<{ reserva: ReservaHost; ya_confirmado: boolean }>>(`${this.base}/orders/${id}/confirm-payment`, null));
  }
  /** Cancelación por el administrador: sin penalidad, reembolso completo. */
  cancelarReserva(id: string, motivo?: string): Observable<{ reserva: ReservaHost; penalidad: number; reembolso: number }> {
    return datos(this.http.post<RespuestaApi<{ reserva: ReservaHost; penalidad: number; reembolso: number }>>(`${this.base}/orders/${id}/cancel`, motivo ? { motivo } : {}));
  }
  ingresos(): Observable<{ mes: string; estancias: number; ingreso_sin_iva: number }[]> {
    return datos(this.http.get<RespuestaApi<{ mes: string; estancias: number; ingreso_sin_iva: number }[]>>(`${this.base}/income`));
  }
  resenas(): Observable<ResenaHost[]> {
    return datos(this.http.get<RespuestaApi<ResenaHost[]>>(`${this.base}/reviews`));
  }
  responderResena(id: string, respuesta: string): Observable<{ id: string }> {
    return datos(this.http.post<RespuestaApi<{ id: string }>>(`${this.base}/reviews/${id}/reply`, { respuesta }));
  }
}
