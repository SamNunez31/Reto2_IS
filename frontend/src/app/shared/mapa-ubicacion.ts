import { AfterViewInit, Component, ElementRef, OnDestroy, input, viewChild } from '@angular/core';
import * as L from 'leaflet';

/**
 * Mapa de solo lectura con un pin en la ubicacion del alojamiento.
 * Se desactiva el zoom con la rueda y el arrastre en movil para no atrapar el desplazamiento de la pagina;
 * los botones de zoom y las flechas del teclado siguen funcionando.
 */
@Component({
  selector: 'app-mapa-ubicacion',
  template: `<div class="mapa mapa-ubicacion" #mapa role="region" [attr.aria-label]="'Mapa: ubicacion aproximada de ' + titulo()"></div>`,
})
export class MapaUbicacionComponent implements AfterViewInit, OnDestroy {
  readonly lat = input.required<number>();
  readonly lon = input.required<number>();
  readonly titulo = input('');
  private readonly contenedor = viewChild.required<ElementRef<HTMLDivElement>>('mapa');
  private mapa?: L.Map;

  ngAfterViewInit(): void {
    const lat = Number(this.lat());
    const lon = Number(this.lon());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    try {
      this.mapa = L.map(this.contenedor().nativeElement, {
        center: [lat, lon],
        zoom: 15,
        scrollWheelZoom: false,
        dragging: !L.Browser.mobile,
        keyboard: true,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      }).addTo(this.mapa);
      L.marker([lat, lon], {
        icon: L.divIcon({ className: 'pin-mapa', html: '<span></span>', iconSize: [30, 42], iconAnchor: [15, 42] }),
        title: this.titulo(),
        alt: this.titulo(),
        keyboard: false,
      }).addTo(this.mapa);
    } catch {
      // Sin mapa, la direccion en texto sigue siendo la referencia
    }
  }

  ngOnDestroy(): void {
    this.mapa?.remove();
  }
}
