import { Component, input } from '@angular/core';
import { ErrorVista } from '../core/services/api-base';

/** Mensaje de error (ProblemDetails.detail + invalidParams por campo). */
@Component({
  selector: 'app-alerta-error',
  template: `
    @if (error(); as e) {
      <div class="alerta alerta-error" role="alert">
        <strong>{{ e.mensaje }}</strong>
        @if (camposLista(e).length) {
          <ul>
            @for (c of camposLista(e); track c[0]) {
              <li><code>{{ c[0] }}</code>: {{ c[1] }}</li>
            }
          </ul>
        }
      </div>
    }
  `,
})
export class AlertaErrorComponent {
  readonly error = input<ErrorVista | null>(null);
  camposLista(e: ErrorVista): [string, string][] {
    return Object.entries(e.campos);
  }
}

@Component({
  selector: 'app-cargando',
  template: `<div class="cargando" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>{{ texto() }}</div>`,
})
export class CargandoComponent {
  readonly texto = input('Cargando…');
}

@Component({
  selector: 'app-vacio',
  template: `<div class="vacio"><p>{{ texto() }}</p><ng-content /></div>`,
})
export class VacioComponent {
  readonly texto = input('No hay resultados');
}

@Component({
  selector: 'app-estrellas',
  template: `@if (n(); as v) {<span class="estrellas" role="img" [attr.aria-label]="v === 1 ? '1 estrella' : v + ' estrellas'">{{ '★'.repeat(v) }}</span>}`,
})
export class EstrellasComponent {
  readonly n = input<number | null>(null);
}

/** Etiqueta de estado de una reserva. */
@Component({
  selector: 'app-estado',
  template: `<span class="badge" [class]="'badge badge-' + estado().toLowerCase()">{{ etiqueta() }}</span>`,
})
export class EstadoComponent {
  readonly estado = input.required<string>();
  /** Nombre a mostrar cuando una pantalla llama a ese estado de otra forma (p. ej. BORRADOR = «Suspendido» en el panel). */
  readonly nombre = input<string | null>(null);
  etiqueta(): string {
    const propio = this.nombre();
    if (propio) return propio;
    const nombres: Record<string, string> = {
      CONFIRMADA: 'Confirmada', PENDIENTE: 'Pendiente', CANCELADA: 'Cancelada', RECHAZADA: 'Rechazada',
      EXPIRADA: 'Expirada', COMPLETADA: 'Completada', PUBLICADO: 'Publicado', BORRADOR: 'Borrador', SUSPENDIDO: 'Suspendido',
      RESUELTO: 'Resuelto', DESCARTADO: 'Descartado',
    };
    return nombres[this.estado()] ?? this.estado();
  }
}
