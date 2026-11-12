import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnfitrionService, EstadoHabitacion, HabitacionHost, ResumenAlojamiento } from '../../core/services/anfitrion.service';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { avisoTemporal } from '../../shared/aviso';
import { ICONOS } from '../../shared/iconos';
import { AlertaErrorComponent, CargandoComponent } from '../../shared/ui';

export const ETIQUETA_ESTADO: Record<EstadoHabitacion, string> = {
  DISPONIBLE: 'Disponible',
  OCUPADA: 'Ocupada',
  EN_PREPARACION: 'En preparación',
};

/**
 * Pestaña «Habitaciones» del admin (el dueño): lista las habitaciones de un hotel y cambia su estado.
 * El check-out las deja EN_PREPARACION; aquí se marcan DISPONIBLE cuando están listas. OCUPADA la pone el check-in.
 */
@Component({
  selector: 'app-habitaciones',
  imports: [FormsModule, DatePipe, AlertaErrorComponent, CargandoComponent],
  template: `
    <p class="ayuda">
      Cada alojamiento tiene una unidad física por cada «cantidad» de su tipo (habitación de hotel, casa, cabaña o departamento). Al hacer check-out la unidad pasa a «En preparación»;
      mientras esté así no se puede reservar (baja el cupo de su tipo). Cuando esté lista, márcala como «Disponible». Las ocupadas se liberan con el check-out del huésped.
    </p>
    @if (ok.texto()) { <p class="alerta alerta-ok" role="status">{{ ok.texto() }}</p> }
    <app-alerta-error [error]="error()" />
    <label class="filtro">Alojamiento
      <select name="hotel" [ngModel]="codigo()" (ngModelChange)="elegir($event)">
        @for (h of hoteles(); track h.codigo) { <option [ngValue]="h.codigo">{{ h.nombre }} · {{ h.tipo }}</option> }
      </select>
    </label>
    @if (cargando()) { <app-cargando /> }
    @else if (!hoteles().length) { <p>No hay alojamientos registrados.</p> }
    @else {
      <div class="resumen-hab" aria-live="polite">
        @for (e of estados; track e) { <span class="badge">{{ etiqueta[e] }}: {{ cuenta()[e] }}</span> }
      </div>
      <div class="tabla-scroll tarjeta">
        <table class="tabla">
          <caption class="sr-only">Unidades del alojamiento</caption>
          <thead><tr><th scope="col">N.º</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Última limpieza</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            @for (h of habitaciones(); track h.id) {
              <tr>
                <td><strong>{{ h.numero }}</strong></td>
                <td>{{ h.unidad }}</td>
                <td>
                  <span class="badge" [class.hab-ocupada]="h.estado === 'OCUPADA'" [class.hab-prep]="h.estado === 'EN_PREPARACION'">{{ etiqueta[h.estado] }}</span>
                  @if (h.reserva_codigo) { <small> · {{ h.reserva_codigo }}</small> }
                </td>
                <td>
                  @if (h.estado === 'DISPONIBLE') {
                    <span class="limpia">Limpia: {{ h.actualizada_en | date: 'dd/MM/yyyy HH:mm' }}</span>
                  } @else if (h.estado === 'EN_PREPARACION') {
                    <span class="pendiente">Pendiente desde {{ h.actualizada_en | date: 'dd/MM/yyyy HH:mm' }}</span>
                  } @else {
                    <span class="gris">Ocupada desde {{ h.actualizada_en | date: 'dd/MM/yyyy HH:mm' }}</span>
                  }
                </td>
                <td>
                  @if (h.estado === 'EN_PREPARACION') {
                    <button type="button" class="btn btn-chico btn-primario" [disabled]="cambiando() === h.id" (click)="cambiar(h, 'DISPONIBLE')">
                      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['publicar']" /></svg>Marcar disponible</button>
                  } @else if (h.estado === 'DISPONIBLE') {
                    <button type="button" class="btn btn-chico" [disabled]="cambiando() === h.id" (click)="cambiar(h, 'EN_PREPARACION')">
                      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['limpieza']" /></svg>Marcar en preparación</button>
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="5">Este alojamiento aún no tiene unidades registradas.</td></tr> }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .filtro { display: inline-flex; flex-direction: column; gap: .25rem; margin: .5rem 0 1rem; }
    .resumen-hab { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: .75rem; }
    .ico { width: 1.05rem; height: 1.05rem; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; margin-right: .35rem; vertical-align: -.2em; }
    .tabla tbody tr { transition: background .15s ease; }
    .tabla tbody tr:hover { background: var(--c-fondo, #faf9f7); }
    .hab-ocupada { background: #fde8e6; color: #8a1c13; }
    .hab-prep { background: #fff4d6; color: #7a5200; }
    .limpia { color: #1d6b3f; font-weight: 600; }
    .pendiente { color: #7a5200; font-weight: 600; }
    .gris { color: var(--gris-700); }
  `,
})
export class HabitacionesComponent implements OnInit {
  private readonly api = inject(AnfitrionService);
  readonly ok = avisoTemporal();
  readonly iconos = ICONOS;
  readonly estados: EstadoHabitacion[] = ['DISPONIBLE', 'EN_PREPARACION', 'OCUPADA'];
  readonly etiqueta = ETIQUETA_ESTADO;
  readonly hoteles = signal<ResumenAlojamiento[]>([]);
  readonly codigo = signal<number | null>(null);
  readonly habitaciones = signal<HabitacionHost[]>([]);
  readonly cargando = signal(false);
  readonly cambiando = signal<string | null>(null);
  readonly error = signal<ErrorVista | null>(null);
  readonly cuenta = computed(() => {
    const c: Record<EstadoHabitacion, number> = { DISPONIBLE: 0, OCUPADA: 0, EN_PREPARACION: 0 };
    for (const h of this.habitaciones()) c[h.estado]++;
    return c;
  });

  ngOnInit(): void {
    this.cargando.set(true);
    this.api.alojamientos().subscribe({
      next: (l) => {
        this.hoteles.set(l);
        if (l.length) this.elegir(l[0].codigo);
        else this.cargando.set(false);
      },
      error: (e) => { this.cargando.set(false); this.error.set(leerError(e)); },
    });
  }

  elegir(codigo: number): void {
    this.codigo.set(codigo);
    this.error.set(null);
    this.cargando.set(true);
    this.api.habitaciones(codigo).subscribe({
      next: (h) => { this.habitaciones.set(h); this.cargando.set(false); },
      error: (e) => { this.cargando.set(false); this.error.set(leerError(e)); },
    });
  }

  cambiar(h: HabitacionHost, estado: 'DISPONIBLE' | 'EN_PREPARACION'): void {
    const codigo = this.codigo();
    if (codigo === null || this.cambiando()) return;
    this.cambiando.set(h.id);
    this.error.set(null);
    this.ok.limpiar();
    this.api.estadoHabitacion(codigo, h.id, estado).subscribe({
      next: () => {
        this.cambiando.set(null);
        this.ok.mostrar(`Unidad ${h.numero}: ${ETIQUETA_ESTADO[estado].toLowerCase()}.`);
        this.elegir(codigo);
      },
      error: (e) => { this.cambiando.set(null); this.error.set(leerError(e)); this.elegir(codigo); },
    });
  }
}
