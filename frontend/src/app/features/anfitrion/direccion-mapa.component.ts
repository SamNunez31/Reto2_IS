import { AfterViewInit, Component, ElementRef, effect, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { CampoMensajeComponent } from '../../shared/campo';
import { dentroDeEcuador, GeocodificacionService, LIMITES_EC, Sugerencia } from './geocodificacion.service';

const CENTRO_EC: L.LatLngTuple = [-1.6, -78.6];
const ESPERA_ESCRITURA_MS = 800;

/**
 * Dirección con sugerencias (OpenStreetMap Nominatim) y mapa Leaflet con un pin arrastrable.
 * Las coordenadas se escriben en los controles `latitud`/`longitud` sin mostrarse al usuario.
 */
@Component({
  selector: 'app-direccion-mapa',
  imports: [ReactiveFormsModule, CampoMensajeComponent],
  template: `
    <div class="grupo">
      <label for="dir-input">Dirección</label>
      <div class="combo">
        <input id="dir-input" [formControl]="direccion()" maxlength="200" autocomplete="off" role="combobox"
               placeholder="Ej: Av. Amazonas N24-03 y Wilson, Quito"
               aria-autocomplete="list" aria-controls="dir-lista" [attr.aria-expanded]="sugerencias().length > 0"
               [attr.aria-activedescendant]="activa() >= 0 ? 'dir-op-' + activa() : null"
               [attr.aria-invalid]="direccion().invalid && direccion().touched" aria-describedby="dir-estado msg-dir"
               (input)="alEscribir()" (keydown)="teclado($event)" (blur)="cerrarLuego()" />
        @if (sugerencias().length) {
          <ul id="dir-lista" class="sugerencias" role="listbox" aria-label="Sugerencias de dirección">
            @for (s of sugerencias(); track $index; let i = $index) {
              <li [id]="'dir-op-' + i" role="option" [attr.aria-selected]="i === activa()" [class.activa]="i === activa()"
                  (mousedown)="$event.preventDefault(); elegir(s)">📍 {{ s.etiqueta }}</li>
            }
          </ul>
        }
      </div>
      <p id="dir-estado" class="ayuda" aria-live="polite">{{ estado() }}</p>
      <app-campo-mensaje [control]="direccion()" id="msg-dir" [mostrarOk]="false" />
    </div>

    <div class="mapa" #mapa role="region" aria-label="Mapa: toca o arrastra el pin hasta la ubicación exacta del alojamiento"></div>
    <p class="ayuda">Toca el mapa o arrastra el pin para afinar la ubicación.</p>
    @if (latitud().invalid && latitud().touched) {
      <p class="msg-campo msg-error" role="alert"><span aria-hidden="true">✗</span> Ubica el alojamiento en el mapa: busca la dirección o toca el mapa.</p>
    } @else if (ubicado()) {
      <p class="msg-campo msg-ok"><span aria-hidden="true">✓</span> Ubicación marcada en el mapa</p>
    }
    @if (avisoMapa()) { <p class="msg-campo msg-error" role="alert"><span aria-hidden="true">✗</span> {{ avisoMapa() }}</p> }
  `,
})
export class DireccionMapaComponent implements AfterViewInit, OnDestroy {
  readonly direccion = input.required<FormControl<string | null>>();
  readonly latitud = input.required<FormControl<number | null>>();
  readonly longitud = input.required<FormControl<number | null>>();
  /** "Ciudad, Provincia": si aún no hay pin, el mapa se centra ahí. */
  readonly ciudad = input('');

  private readonly geo = inject(GeocodificacionService);
  private readonly contenedor = viewChild.required<ElementRef<HTMLDivElement>>('mapa');
  readonly sugerencias = signal<Sugerencia[]>([]);
  readonly activa = signal(-1);
  readonly estado = signal('Escribe la calle, número y referencia; te sugeriremos coincidencias.');
  readonly avisoMapa = signal('');
  readonly ubicado = signal(false);

  private mapa?: L.Map;
  private pin?: L.Marker;
  private temporizador?: ReturnType<typeof setTimeout>;
  private peticion?: AbortController;

  constructor() {
    // Centrar en la ciudad elegida mientras el usuario no haya puesto el pin
    effect(() => {
      const ciudad = this.ciudad();
      if (ciudad && !this.ubicado() && this.latitud().value === null) this.centrarEn(ciudad);
    });
  }

  ngAfterViewInit(): void {
    const lat = this.latitud().value;
    const lon = this.longitud().value;
    const hayPunto = lat !== null && lon !== null && dentroDeEcuador(lat, lon);
    this.mapa = L.map(this.contenedor().nativeElement, {
      center: hayPunto ? [lat, lon] : CENTRO_EC,
      zoom: hayPunto ? 16 : 6,
      maxBounds: L.latLngBounds([LIMITES_EC.latMin - 1, LIMITES_EC.lonMin - 1], [LIMITES_EC.latMax + 1, LIMITES_EC.lonMax + 1]),
      minZoom: 5,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    }).addTo(this.mapa);
    this.mapa.on('click', (e: L.LeafletMouseEvent) => this.colocar(e.latlng.lat, e.latlng.lng, false));
    if (hayPunto) this.colocar(lat, lon, false);
    // El contenedor puede haber cambiado de tamaño al mostrarse el paso
    setTimeout(() => this.mapa?.invalidateSize(), 0);
  }

  ngOnDestroy(): void {
    clearTimeout(this.temporizador);
    this.peticion?.abort();
    this.mapa?.remove();
  }

  /** Espera 800 ms sin escribir antes de buscar (y el servicio limita a 1 petición por segundo). */
  alEscribir(): void {
    clearTimeout(this.temporizador);
    this.peticion?.abort();
    const texto = (this.direccion().value ?? '').trim();
    if (texto.length < 4) {
      this.sugerencias.set([]);
      return;
    }
    this.temporizador = setTimeout(() => this.buscar(texto), ESPERA_ESCRITURA_MS);
  }

  private async buscar(texto: string): Promise<void> {
    this.peticion = new AbortController();
    this.estado.set('Buscando…');
    try {
      const r = await this.geo.buscar(texto, this.peticion.signal);
      this.sugerencias.set(r);
      this.activa.set(-1);
      this.estado.set(
        r.length
          ? `${r.length} sugerencia${r.length === 1 ? '' : 's'}: elige una o sigue escribiendo.`
          : 'No encontramos esa dirección. No pasa nada: déjala escrita como la conoces y ubica el pin en el mapa a mano.',
      );
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.sugerencias.set([]);
      this.estado.set('No pudimos consultar el buscador de direcciones. Escribe la dirección y ubica el pin en el mapa a mano.');
    }
  }

  elegir(s: Sugerencia): void {
    this.direccion().setValue(s.etiqueta.slice(0, 200));
    this.direccion().markAsTouched();
    this.sugerencias.set([]);
    this.estado.set('Dirección elegida. Revisa que el pin esté sobre el alojamiento y muévelo si hace falta.');
    this.colocar(s.lat, s.lon, true);
  }

  teclado(ev: KeyboardEvent): void {
    const n = this.sugerencias().length;
    if (!n) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.activa.update((i) => (i + 1) % n);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.activa.update((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (ev.key === 'Enter' && this.activa() >= 0) {
      ev.preventDefault();
      this.elegir(this.sugerencias()[this.activa()]);
    } else if (ev.key === 'Escape') {
      this.sugerencias.set([]);
    }
  }

  cerrarLuego(): void {
    setTimeout(() => this.sugerencias.set([]), 150);
  }

  /** Pone el pin (si está dentro de Ecuador) y guarda las coordenadas en el formulario. */
  private colocar(lat: number, lon: number, acercar: boolean): void {
    if (!this.mapa) return;
    if (!dentroDeEcuador(lat, lon)) {
      this.avisoMapa.set('El pin debe quedar dentro de Ecuador (incluidas las Galápagos).');
      if (this.pin && this.latitud().value !== null && this.longitud().value !== null) {
        this.pin.setLatLng([this.latitud().value as number, this.longitud().value as number]);
      }
      return;
    }
    this.avisoMapa.set('');
    const redondo = (x: number) => Math.round(x * 1e6) / 1e6;
    this.latitud().setValue(redondo(lat));
    this.longitud().setValue(redondo(lon));
    this.latitud().markAsTouched();
    this.longitud().markAsTouched();
    this.ubicado.set(true);
    if (!this.pin) {
      this.pin = L.marker([lat, lon], {
        draggable: true,
        keyboard: true,
        title: 'Ubicación del alojamiento',
        alt: 'Pin de ubicación',
        icon: L.divIcon({ className: 'pin-mapa', html: '<span></span>', iconSize: [30, 42], iconAnchor: [15, 42] }),
      }).addTo(this.mapa);
      this.pin.on('dragend', () => {
        const p = this.pin!.getLatLng();
        this.colocar(p.lat, p.lng, false);
      });
    } else {
      this.pin.setLatLng([lat, lon]);
    }
    if (acercar) this.mapa.setView([lat, lon], 17);
  }

  private async centrarEn(ciudad: string): Promise<void> {
    try {
      const [r] = await this.geo.buscar(`${ciudad}, Ecuador`);
      if (r && !this.ubicado()) this.mapa?.setView([r.lat, r.lon], 13);
    } catch {
      /* sin conexión al buscador: el mapa queda en la vista de Ecuador */
    }
  }
}
