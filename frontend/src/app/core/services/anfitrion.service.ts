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
  /** Momento de salida (check-out); null si aún no salió */
  checkout_en: string | null;
  /** Habitación asignada en el check-in (hotel: «Suite Familiar 109») */
  habitacion_asignada: string | null;
  /** Hora de salida del alojamiento (HH:MM:SS) */
  hora_checkout: string;
  /** Motivo de la cancelación tal como lo envió quien canceló */
  motivo_cancelacion: string | null;
  /** Quién canceló: CLIENTE, HOTEL, ADMIN o SAGA_ORCHESTRATOR */
  cancelada_por: string | null;
  cancelada_en: string | null;
  /** Titular real de la reserva de Booking (null en reservas del canal propio) */
  titular_nombre: string | null;
  titular_tipo_documento: string | null;
  titular_identificacion: string | null;
}

export interface RespuestaLlegada {
  reserva: ReservaHost;
  estado: 'CHECKED_IN';
  habitacion_asignada: string;
  /** Huéspedes que llegaron de más respecto a los reservados */
  huespedes_extra: number;
  aforo_maximo: number;
  ya_registrado: boolean;
  booking_notificado: boolean;
}

export interface ConsumoExtra {
  item: string;
  cantidad: number;
  precio: string;
}

export interface DatosSalida {
  observaciones?: string;
  consumos?: ConsumoExtra[];
  metodo_pago_consumos?: 'EFECTIVO' | 'CARGO_A_RESERVA';
}

export interface RespuestaSalida {
  reserva: ReservaHost;
  estado: 'CHECKED_OUT';
  habitacion_en_preparacion: string | null;
  consumos_total: string;
  ya_registrado: boolean;
  booking_notificado: boolean;
}

export type EstadoHabitacion = 'DISPONIBLE' | 'OCUPADA' | 'EN_PREPARACION';

export interface HabitacionHost {
  id: string;
  numero: string;
  estado: EstadoHabitacion;
  actualizada_en: string;
  alojamiento_codigo: number;
  alojamiento: string;
  unidad: string;
  reserva_codigo: string | null;
  /** Próxima llegada con esta habitación asignada y sin check-in (fechas AAAA-MM-DD) */
  proxima_codigo?: string | null;
  proxima_entrada?: string | null;
  proxima_salida?: string | null;
  proxima_huesped?: string | null;
}

export interface SugerenciaHabitacion {
  codigo_tipo: string;
  nombre: string;
  capacidad: number;
  precio_noche: number;
  libres: number;
}

export interface DatosCheckinHost {
  es_hotel: boolean;
  /** El alojamiento tiene más de una unidad física: solo entonces se muestra el número */
  numerada: boolean;
  /** Otras habitaciones libres del mismo tipo, para el cambio excepcional en recepción */
  habitaciones_libres: { id: string; numero: string }[];
  /** Habitación fijada al crear la reserva («Habitación Individual 101») */
  habitacion_asignada: string | null;
  alojamiento_codigo: number;
  /** Otros tipos libres esas fechas, para los huéspedes que llegaron de más */
  sugerencias: SugerenciaHabitacion[];
}

export interface FilaIngresos {
  mes: string;
  estancias: number;
  /** Lo que queda para el alojamiento (hospedaje + servicio + limpieza) */
  ingreso_sin_iva: number;
  /** IVA y tasa municipal */
  impuestos: number;
  /** Lo cobrado al huésped */
  ingreso_bruto: number;
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
  registrarLlegada(id: string, cuerpo: { observaciones?: string; huespedes_reales?: number; habitacion_id?: string; motivo_cambio?: string } = {}): Observable<RespuestaLlegada> {
    return datos(this.http.post<RespuestaApi<RespuestaLlegada>>(`${this.base}/orders/${id}/arrival`, cuerpo));
  }

  /** Datos del check-in: habitación ya asignada y tipos libres por si llegaron más huéspedes. */
  datosCheckin(id: string): Observable<DatosCheckinHost> {
    return datos(this.http.get<RespuestaApi<DatosCheckinHost>>(`${this.base}/orders/${id}/available-rooms`));
  }
  /** Check-out en recepción: la habitación queda EN_PREPARACION y se avisa a Booking. */
  registrarSalida(id: string, cuerpo: DatosSalida = {}): Observable<RespuestaSalida> {
    return datos(this.http.post<RespuestaApi<RespuestaSalida>>(`${this.base}/orders/${id}/departure`, cuerpo));
  }
  habitaciones(codigo: number): Observable<HabitacionHost[]> {
    return datos(this.http.get<RespuestaApi<HabitacionHost[]>>(`${this.base}/accommodations/${codigo}/rooms`));
  }
  /** El dueño marca una habitación EN_PREPARACION o DISPONIBLE. */
  estadoHabitacion(codigo: number, id: string, estado: 'DISPONIBLE' | 'EN_PREPARACION'): Observable<{ id: string; estado: EstadoHabitacion }> {
    return datos(this.http.patch<RespuestaApi<{ id: string; estado: EstadoHabitacion }>>(`${this.base}/accommodations/${codigo}/rooms/${id}`, { estado }));
  }

  confirmarPago(id: string): Observable<{ reserva: ReservaHost; ya_confirmado: boolean }> {
    return datos(this.http.post<RespuestaApi<{ reserva: ReservaHost; ya_confirmado: boolean }>>(`${this.base}/orders/${id}/confirm-payment`, null));
  }
  /** Cancelación por el administrador: sin penalidad, reembolso completo. */
  cancelarReserva(id: string, motivo?: string): Observable<{ reserva: ReservaHost; penalidad: number; reembolso: number }> {
    return datos(this.http.post<RespuestaApi<{ reserva: ReservaHost; penalidad: number; reembolso: number }>>(`${this.base}/orders/${id}/cancel`, motivo ? { motivo } : {}));
  }
  ingresos(): Observable<FilaIngresos[]> {
    return datos(this.http.get<RespuestaApi<FilaIngresos[]>>(`${this.base}/income`));
  }
  /** Reintenta ahora los avisos pendientes a Booking (check-in y check-out). */
  sincronizarBooking(): Observable<{ checkin: number; checkout: number }> {
    return datos(this.http.post<RespuestaApi<{ checkin: number; checkout: number }>>(`${this.base}/orders/sync`, null));
  }
  resenas(): Observable<ResenaHost[]> {
    return datos(this.http.get<RespuestaApi<ResenaHost[]>>(`${this.base}/reviews`));
  }
  responderResena(id: string, respuesta: string): Observable<{ id: string }> {
    return datos(this.http.post<RespuestaApi<{ id: string }>>(`${this.base}/reviews/${id}/reply`, { respuesta }));
  }
}
