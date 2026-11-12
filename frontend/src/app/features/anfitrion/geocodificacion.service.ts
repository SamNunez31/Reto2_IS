import { Injectable } from '@angular/core';

/** Límites de Ecuador (incluye Galápagos): los mismos que valida el backend (LATITUD_EC / LONGITUD_EC). */
export const LIMITES_EC = { latMin: -5, latMax: 2, lonMin: -93, lonMax: -75 } as const;

export const dentroDeEcuador = (lat: number, lon: number): boolean =>
  lat >= LIMITES_EC.latMin && lat <= LIMITES_EC.latMax && lon >= LIMITES_EC.lonMin && lon <= LIMITES_EC.lonMax;

/** Arma una dirección corta y legible («Calle 123, Barrio, Ciudad») a partir de la respuesta de Nominatim. */
export const etiquetaDireccion = (j: { display_name?: string; address?: Record<string, string> }): string => {
  const a = j.address ?? {};
  const calle = [a['road'] ?? a['pedestrian'] ?? a['footway'] ?? a['path'], a['house_number']].filter(Boolean).join(' ');
  const barrio = a['neighbourhood'] ?? a['suburb'] ?? a['quarter'];
  const ciudad = a['city'] ?? a['town'] ?? a['village'] ?? a['municipality'] ?? a['county'];
  const partes = [calle, barrio, ciudad].filter((x, i, l): x is string => !!x && l.indexOf(x) === i);
  return (partes.length >= 2 ? partes.join(', ') : (j.display_name ?? partes.join(', '))).slice(0, 200);
};

export interface Sugerencia {
  etiqueta: string;
  lat: number;
  lon: number;
}

/**
 * Búsqueda de direcciones con OpenStreetMap Nominatim (https://nominatim.org).
 * Política de uso: máximo 1 petición por segundo, sin autocompletado agresivo (el componente espera 800 ms
 * entre pulsaciones) y con atribución "© OpenStreetMap contributors" visible en el mapa.
 */
@Injectable({ providedIn: 'root' })
export class GeocodificacionService {
  private static readonly URL = 'https://nominatim.openstreetmap.org/search';
  private static readonly INTERVALO_MS = 1000;
  private ultima = 0;
  private cola: Promise<unknown> = Promise.resolve();

  /** Dirección de un punto del mapa (geocodificación inversa). Comparte la cola de 1 petición por segundo. */
  inversa(lat: number, lon: number, aborto?: AbortSignal): Promise<string> {
    const tarea = this.cola.then(async () => {
      const espera = this.ultima + GeocodificacionService.INTERVALO_MS - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      if (aborto?.aborted) return '';
      this.ultima = Date.now();
      const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'es' });
      const r = await fetch(`${GeocodificacionService.URL.replace('/search', '/reverse')}?${params}`, { signal: aborto, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`);
      return etiquetaDireccion((await r.json()) as { display_name?: string; address?: Record<string, string> });
    });
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  /** Busca direcciones en Ecuador. Las peticiones se encolan para no superar 1 por segundo. */
  buscar(texto: string, aborto?: AbortSignal): Promise<Sugerencia[]> {
    const tarea = this.cola.then(async () => {
      const espera = this.ultima + GeocodificacionService.INTERVALO_MS - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      if (aborto?.aborted) return [];
      this.ultima = Date.now();
      const params = new URLSearchParams({
        q: texto, format: 'jsonv2', countrycodes: 'ec', 'accept-language': 'es', limit: '5',
        viewbox: `${LIMITES_EC.lonMin},${LIMITES_EC.latMax},${LIMITES_EC.lonMax},${LIMITES_EC.latMin}`, bounded: '1',
      });
      const r = await fetch(`${GeocodificacionService.URL}?${params}`, { signal: aborto, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`);
      const filas = (await r.json()) as { display_name: string; lat: string; lon: string }[];
      return filas
        .map((f) => ({ etiqueta: f.display_name, lat: Number(f.lat), lon: Number(f.lon) }))
        .filter((s) => dentroDeEcuador(s.lat, s.lon));
    });
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }
}
