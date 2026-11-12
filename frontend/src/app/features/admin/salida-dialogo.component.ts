import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatosSalida, ReservaHost } from '../../core/services/anfitrion.service';
import { rangoLargo } from '../../shared/textos';

interface LineaConsumo {
  item: string;
  cantidad: number;
  precio: string;
}

/**
 * Diálogo «Registrar check-out»: como en recepción de un hotel, se repasa la cuenta (consumos extra: minibar,
 * restaurante…), se confirma la devolución de llaves y se deja constancia. Al confirmar la reserva se completa,
 * la habitación pasa a «En preparación» y se avisa a Booking.
 */
@Component({
  selector: 'app-salida-dialogo',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <!-- Clic en el fondo = cerrar; con teclado se cierra con Esc (evento cancel del <dialog>) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialogo class="sd-dialogo" aria-modal="true" aria-labelledby="sd-titulo" aria-describedby="sd-resumen"
            (cancel)="$event.preventDefault(); cerrar.emit()" (click)="clicFondo($event)">
      @if (reserva(); as r) {
        <form class="sd-cuerpo" (ngSubmit)="enviar()" novalidate>
          <h2 id="sd-titulo">Registrar check-out · <span class="sd-codigo">{{ r.codigo }}</span></h2>
          <p id="sd-resumen" class="sd-resumen">{{ titular(r) }} · {{ r.habitacion_asignada || r.alojamiento }}</p>

          <dl class="sd-datos">
            <div><dt>Estadía</dt><dd>{{ rango(r) }}</dd></div>
            @if (r.checkin_en) { <div><dt>Llegó</dt><dd>{{ r.checkin_en | date: 'dd/MM/yyyy HH:mm' }}</dd></div> }
            <div><dt>Salida prevista</dt><dd>{{ r.hora_checkout.slice(0, 5) }}</dd></div>
            <div><dt>Total de la reserva</dt><dd>{{ r.total | currency: 'USD' }}</dd></div>
          </dl>
          @if (tardia(r)) {
            <p class="sd-aviso" role="status">La salida es posterior a la hora de check-out ({{ r.hora_checkout.slice(0, 5) }}). Revisa si corresponde un cargo por salida tardía.</p>
          }

          <fieldset class="sd-extras">
            <legend>Consumos extra <span class="sd-opcional">(minibar, restaurante… opcional)</span></legend>
            @for (l of lineas(); track $index; let i = $index) {
              <div class="sd-linea">
                <input type="text" [name]="'item' + i" [attr.aria-label]="'Consumo ' + (i + 1)" placeholder="Ej. Agua, snack" maxlength="80" [(ngModel)]="l.item" />
                <input type="number" [name]="'cant' + i" [attr.aria-label]="'Cantidad del consumo ' + (i + 1)" min="1" max="100" step="1" [(ngModel)]="l.cantidad" />
                <input type="text" inputmode="decimal" [name]="'prec' + i" [attr.aria-label]="'Precio unitario del consumo ' + (i + 1)" placeholder="0.00" [(ngModel)]="l.precio" />
                <button type="button" class="btn btn-chico" (click)="quitar(i)" [attr.aria-label]="'Quitar consumo ' + (i + 1)">Quitar</button>
              </div>
            }
            <button type="button" class="btn btn-chico" (click)="agregar()">+ Agregar consumo</button>
            @if (errorConsumos(); as e) { <p class="sd-error" role="alert">{{ e }}</p> }
            @if (totalExtras() > 0) {
              <p class="sd-total">Total extras: <strong>{{ totalExtras() | currency: 'USD' }}</strong></p>
              <label class="sd-metodo">Se cobra con
                <select name="metodo" [(ngModel)]="metodo">
                  <option value="EFECTIVO">Efectivo en recepción</option>
                  <option value="CARGO_A_RESERVA">Cargo a la tarjeta registrada</option>
                </select>
              </label>
            }
          </fieldset>

          <div class="sd-campo">
            <label for="sd-obs">Observaciones <span class="sd-opcional">(opcional)</span></label>
            <textarea id="sd-obs" name="obs" rows="2" maxlength="300" [(ngModel)]="observaciones" placeholder="Ej. daños, objetos olvidados, salida tardía…"></textarea>
          </div>

          <label class="sd-llaves">
            <input type="checkbox" name="llaves" [(ngModel)]="llaves" />
            <span>Recibí las llaves o tarjetas de la habitación</span>
          </label>
          <p class="sd-ayuda">{{ llaves ? 'Al confirmar la habitación pasará a «En preparación» y se avisará a Booking.' : 'Marca esta casilla para poder confirmar.' }}</p>

          <div class="sd-acciones">
            <button type="button" class="btn" (click)="cerrar.emit()">Todavía no</button>
            <button type="submit" class="btn btn-primario" [disabled]="!llaves || enviando()">Confirmar check-out</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .sd-dialogo { border: 0; padding: 0; border-radius: var(--radio-l); box-shadow: var(--sombra-l); width: min(560px, calc(100vw - 2 * var(--gutter))); max-height: calc(100vh - 2rem); color: var(--c-texto); background: var(--c-superficie); }
    .sd-dialogo::backdrop { background: rgb(0 0 0 / .5); }
    .sd-cuerpo { padding: 1.5rem 1.5rem 1.25rem; text-align: left; }
    h2 { font-family: var(--fuente-titulos); font-weight: 400; font-size: 1.45rem; margin: 0 0 .25rem; }
    .sd-resumen { margin: 0 0 1rem; color: var(--gris-700); }
    .sd-datos { display: grid; gap: .4rem; margin: 0 0 1rem; padding: .8rem 1rem; background: var(--c-fondo, #f6f6f4); border-radius: var(--radio-s); }
    .sd-datos div { display: flex; justify-content: space-between; gap: 1rem; }
    .sd-datos dt { color: var(--gris-700); }
    .sd-datos dd { margin: 0; font-weight: 600; text-align: right; }
    .sd-aviso { margin: 0 0 1rem; padding: .6rem .8rem; background: #fff4d6; color: #7a5200; border-radius: var(--radio-s); font-size: .9rem; }
    .sd-extras { border: 1px solid var(--gris-300, #ddd); border-radius: var(--radio-s); padding: .75rem 1rem 1rem; margin: 0 0 1rem; display: grid; gap: .5rem; }
    .sd-extras legend { font-weight: 600; padding: 0 .25rem; }
    .sd-linea { display: grid; grid-template-columns: 1fr 4.5rem 5.5rem auto; gap: .4rem; align-items: center; }
    .sd-linea input { width: 100%; min-width: 0; }
    .sd-total { margin: 0; }
    .sd-metodo { display: flex; flex-direction: row; align-items: center; gap: .6rem; font-weight: 600; }
    .sd-opcional { font-weight: 400; color: var(--gris-700); }
    .sd-campo { display: grid; gap: .3rem; margin-bottom: .9rem; }
    .sd-campo label { margin: 0; font-size: 1rem; color: var(--c-texto); font-weight: 600; flex-direction: row; display: block; }
    .sd-campo textarea { width: 100%; resize: vertical; font: inherit; }
    .sd-ayuda { margin: .25rem 0 0 1.85rem; font-size: .85rem; color: var(--gris-700); }
    .sd-error { margin: 0; font-size: .875rem; color: var(--c-error-texto, #b3261e); font-weight: 600; }
    .sd-llaves { display: flex; flex-direction: row; align-items: flex-start; gap: .6rem; font-size: 1rem; color: var(--c-texto); font-weight: 600; cursor: pointer; margin: .4rem 0 0; }
    .sd-llaves input { width: 1.25rem; height: 1.25rem; margin-top: .1rem; flex: none; }
    .sd-acciones { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1.1rem; flex-wrap: wrap; }
  `,
})
export class SalidaDialogoComponent {
  /** Reserva que sale; `null` = cerrado. */
  readonly reserva = input<ReservaHost | null>(null);
  readonly enviando = input(false);
  readonly confirmar = output<DatosSalida>();
  readonly cerrar = output<void>();

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  protected readonly lineas = signal<LineaConsumo[]>([]);
  protected readonly errorConsumos = signal<string | null>(null);
  protected metodo: 'EFECTIVO' | 'CARGO_A_RESERVA' = 'EFECTIVO';
  protected observaciones = '';
  protected llaves = false;
  private foco: HTMLElement | null = null;

  /** Total de consumos válidos (se recalcula en cada ciclo de detección: ngModel edita las líneas en sitio). */
  protected totalExtras(): number {
    return this.lineas().reduce((t, l) => t + (this.valida(l) ? Number(l.cantidad) * Number(l.precio) : 0), 0);
  }

  constructor() {
    effect(() => {
      const r = this.reserva();
      const d = this.dialogo().nativeElement;
      if (r && !d.open) {
        this.foco = document.activeElement as HTMLElement | null;
        this.lineas.set([]);
        this.errorConsumos.set(null);
        this.metodo = 'EFECTIVO';
        this.observaciones = '';
        this.llaves = false;
        d.showModal();
      } else if (!r && d.open) {
        d.close();
        this.foco?.focus?.();
        this.foco = null;
      }
    });
  }

  protected rango = (r: ReservaHost): string => rangoLargo(r.fecha_entrada, r.fecha_salida);
  protected titular = (r: ReservaHost): string => r.titular_nombre || r.huesped;

  /** ¿Ya pasó la hora de check-out del día de salida? */
  protected tardia(r: ReservaHost): boolean {
    const limite = new Date(`${r.fecha_salida.slice(0, 10)}T${r.hora_checkout.slice(0, 8)}`);
    return !Number.isNaN(limite.getTime()) && Date.now() > limite.getTime();
  }

  protected agregar(): void {
    this.lineas.update((l) => [...l, { item: '', cantidad: 1, precio: '' }]);
  }

  protected quitar(i: number): void {
    this.lineas.update((l) => l.filter((_, k) => k !== i));
  }

  private valida(l: LineaConsumo): boolean {
    return l.item.trim().length > 0 && Number.isInteger(Number(l.cantidad)) && Number(l.cantidad) >= 1 && /^\d{1,9}(\.\d{1,2})?$/.test(String(l.precio).trim());
  }

  protected enviar(): void {
    if (!this.llaves || this.enviando()) return;
    // Una línea completamente vacía se ignora; una a medias es un error
    const usadas = this.lineas().filter((l) => l.item.trim() || String(l.precio).trim());
    if (usadas.some((l) => !this.valida(l))) {
      this.errorConsumos.set('Cada consumo necesita nombre, cantidad entera y precio (p. ej. 3.50).');
      return;
    }
    this.errorConsumos.set(null);
    const consumos = usadas.map((l) => ({ item: l.item.trim(), cantidad: Number(l.cantidad), precio: Number(String(l.precio).trim()).toFixed(2) }));
    const obs = this.observaciones.trim();
    this.confirmar.emit({
      ...(obs ? { observaciones: obs } : {}),
      ...(consumos.length ? { consumos, metodo_pago_consumos: this.metodo } : {}),
    });
  }

  /** Clic en el fondo oscuro (fuera del cuadro) = cerrar. */
  protected clicFondo(ev: MouseEvent): void {
    if (ev.target === this.dialogo().nativeElement) this.cerrar.emit();
  }
}
