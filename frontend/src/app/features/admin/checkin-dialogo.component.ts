import { CurrencyPipe } from '@angular/common';
import { Component, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReservaHost } from '../../core/services/anfitrion.service';
import { noches, plural, rangoLargo } from '../../shared/textos';

export interface DatosCheckin {
  huespedes_reales: number;
  observaciones?: string;
}

/**
 * Diálogo «Registrar check-in» del panel de administración: muestra los datos del huésped y de la estadía
 * y pide lo que recepción confirma al recibirlo. <dialog> modal: foco atrapado, fondo inerte, Esc = cerrar.
 */
@Component({
  selector: 'app-checkin-dialogo',
  imports: [FormsModule, CurrencyPipe],
  template: `
    <!-- Clic en el fondo = cerrar; con teclado se cierra con Esc (evento cancel del <dialog>) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialogo class="ck-dialogo" aria-modal="true" aria-labelledby="ck-titulo" aria-describedby="ck-resumen"
            (cancel)="$event.preventDefault(); cerrar.emit()" (click)="clicFondo($event)">
      @if (reserva(); as r) {
        <form class="ck-cuerpo" (ngSubmit)="enviar()" novalidate>
          <h2 id="ck-titulo">Registrar check-in · <span class="ck-codigo">{{ r.codigo }}</span></h2>
          <p id="ck-resumen" class="ck-resumen">{{ r.huesped }} · {{ r.alojamiento }} · {{ rango(r) }}</p>

          <dl class="ck-datos">
            <div><dt>Titular de la reserva</dt><dd>{{ r.huesped }}</dd></div>
            <div><dt>Alojamiento</dt><dd>{{ r.alojamiento }}</dd></div>
            <div><dt>Estadía</dt><dd>{{ rango(r) }} · {{ nochesTxt(r) }}</dd></div>
            <div><dt>Huéspedes reservados</dt><dd>{{ personas(r.num_huespedes) }}</dd></div>
            <div><dt>Total de la reserva</dt><dd>{{ r.total | currency: 'USD' }}</dd></div>
          </dl>

          <div class="ck-campo">
            <label for="ck-reales">Huéspedes que llegaron</label>
            <input id="ck-reales" name="reales" type="number" inputmode="numeric" min="1" max="30" step="1" [(ngModel)]="reales"
                   [attr.aria-invalid]="errorReales() ? 'true' : null" [attr.aria-describedby]="errorReales() ? 'ck-error-reales' : null" />
            @if (errorReales(); as e) { <p id="ck-error-reales" class="ck-error" role="alert">{{ e }}</p> }
          </div>

          <div class="ck-campo">
            <label for="ck-obs">Observaciones <span class="ck-opcional">(opcional)</span></label>
            <textarea id="ck-obs" name="obs" rows="3" maxlength="300" [(ngModel)]="observaciones" aria-describedby="ck-contador"
                      placeholder="Ej. llegada tardía, solicita cuna, equipaje en custodia…"></textarea>
            <p id="ck-contador" class="ck-ayuda">{{ observaciones.length }}/300</p>
          </div>

          <label class="ck-verificado">
            <input type="checkbox" name="verificado" [(ngModel)]="verificado" aria-describedby="ck-ayuda-verif" />
            <span>Verifiqué el documento de identidad del titular</span>
          </label>
          <p id="ck-ayuda-verif" class="ck-ayuda">
            {{ verificado ? 'Al confirmar se asignará la habitación y se avisará a Booking.' : 'Marca esta casilla para poder confirmar.' }}
          </p>

          <div class="ck-acciones">
            <button type="button" class="btn" (click)="cerrar.emit()">Todavía no</button>
            <button type="submit" class="btn btn-primario" [disabled]="!verificado || enviando()">Confirmar check-in</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .ck-dialogo { border: 0; padding: 0; border-radius: var(--radio-l); box-shadow: var(--sombra-l); width: min(520px, calc(100vw - 2 * var(--gutter))); max-height: calc(100vh - 2rem); color: var(--c-texto); background: var(--c-superficie); }
    .ck-dialogo::backdrop { background: rgb(0 0 0 / .5); }
    .ck-cuerpo { padding: 1.5rem 1.5rem 1.25rem; text-align: left; }
    h2 { font-family: var(--fuente-titulos); font-weight: 400; font-size: 1.45rem; margin: 0 0 .25rem; }
    .ck-codigo { font-variant-numeric: tabular-nums; }
    .ck-resumen { margin: 0 0 1rem; color: var(--gris-700); }
    .ck-datos { display: grid; gap: .4rem; margin: 0 0 1.1rem; padding: .8rem 1rem; background: var(--c-fondo, #f6f6f4); border-radius: var(--radio-s); }
    .ck-datos div { display: flex; justify-content: space-between; gap: 1rem; }
    .ck-datos dt { color: var(--gris-700); }
    .ck-datos dd { margin: 0; font-weight: 600; text-align: right; }
    .ck-campo { display: grid; gap: .3rem; margin-bottom: .9rem; }
    .ck-campo label { font-weight: 600; }
    .ck-opcional { font-weight: 400; color: var(--gris-700); }
    .ck-campo input { width: 8rem; }
    .ck-campo textarea { width: 100%; resize: vertical; font: inherit; }
    .ck-ayuda { margin: 0; font-size: .85rem; color: var(--gris-700); }
    .ck-error { margin: 0; font-size: .875rem; color: var(--c-error-texto, #b3261e); font-weight: 600; }
    .ck-verificado { display: flex; align-items: flex-start; gap: .6rem; font-weight: 600; cursor: pointer; margin-top: .4rem; }
    .ck-verificado input { width: 1.25rem; height: 1.25rem; margin-top: .1rem; flex: none; }
    .ck-verificado + .ck-ayuda { margin: .25rem 0 0 1.85rem; }
    .ck-acciones { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1.1rem; flex-wrap: wrap; }
  `,
})
export class CheckinDialogoComponent {
  /** Reserva a registrar; `null` = cerrado. */
  readonly reserva = input<ReservaHost | null>(null);
  readonly enviando = input(false);
  readonly confirmar = output<DatosCheckin>();
  readonly cerrar = output<void>();

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  protected reales = 1;
  protected observaciones = '';
  protected verificado = false;
  protected readonly errorReales = signal<string | null>(null);
  private foco: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const r = this.reserva();
      const d = this.dialogo().nativeElement;
      if (r && !d.open) {
        this.foco = document.activeElement as HTMLElement | null;
        this.reales = r.num_huespedes;
        this.observaciones = '';
        this.verificado = false;
        this.errorReales.set(null);
        d.showModal();
      } else if (!r && d.open) {
        d.close();
        this.foco?.focus?.();
        this.foco = null;
      }
    });
  }

  protected rango = (r: ReservaHost): string => rangoLargo(r.fecha_entrada, r.fecha_salida);
  protected nochesTxt = (r: ReservaHost): string => plural(noches(r.fecha_entrada, r.fecha_salida), 'noche');
  protected personas = (n: number): string => plural(n, 'huésped', 'huéspedes');

  protected enviar(): void {
    if (!this.verificado || this.enviando()) return;
    const n = Number(this.reales);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      this.errorReales.set('Indica un número entero de huéspedes entre 1 y 30.');
      document.getElementById('ck-reales')?.focus();
      return;
    }
    this.errorReales.set(null);
    const obs = this.observaciones.trim();
    this.confirmar.emit({ huespedes_reales: n, ...(obs ? { observaciones: obs } : {}) });
  }

  /** Clic en el fondo oscuro (fuera del cuadro) = cerrar. */
  protected clicFondo(ev: MouseEvent): void {
    if (ev.target === this.dialogo().nativeElement) this.cerrar.emit();
  }
}
