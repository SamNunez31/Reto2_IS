import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConsumoExtra, DatosSalida, ReservaHost } from '../../core/services/anfitrion.service';
import { rangoLargo } from '../../shared/textos';

interface LineaConsumo {
  item: string;
  cantidad: number | null;
  /** Texto tal como lo escribe la persona (admite coma o punto decimal) */
  precio: string;
}

interface ErrorLinea {
  item?: string;
  cantidad?: string;
  precio?: string;
}

const MAX_LINEAS = 20;

/** «3,5» o «3.50» -> 3.5; null si no es un importe válido (> 0, hasta 2 decimales). */
const leerPrecio = (t: string): number | null => {
  const x = t.trim().replace(',', '.');
  return /^\d{1,7}(\.\d{1,2})?$/.test(x) && Number(x) > 0 ? Number(x) : null;
};

/**
 * Diálogo «Registrar check-out»: como en recepción de un hotel, se repasa la cuenta (consumos extra: minibar,
 * restaurante…), se confirma la devolución de llaves y se deja constancia. Al confirmar la reserva se completa,
 * la unidad pasa a «En preparación» y se avisa a Booking.
 * Pensado a prueba de errores: campos con nombre visible, valores por defecto, errores junto al campo,
 * el fondo no cierra el diálogo si ya se escribió algo y no se puede confirmar sin recibir las llaves.
 */
@Component({
  selector: 'app-salida-dialogo',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <!-- Clic en el fondo = cerrar (salvo que ya haya datos escritos); con teclado, Esc (evento cancel del <dialog>) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialogo class="sd-dialogo" aria-modal="true" aria-labelledby="sd-titulo" aria-describedby="sd-resumen"
            (cancel)="$event.preventDefault(); intentarCerrar()" (click)="clicFondo($event)">
      @if (reserva(); as r) {
        <form class="sd-cuerpo" (ngSubmit)="enviar()" novalidate>
          <h2 id="sd-titulo">Registrar check-out</h2>
          <p id="sd-resumen" class="sd-resumen"><strong>{{ titular(r) }}</strong> · {{ r.habitacion_asignada || r.alojamiento }} · <span class="sd-codigo">{{ r.codigo }}</span></p>

          <dl class="sd-datos">
            <div><dt>Estadía</dt><dd>{{ rango(r) }}</dd></div>
            @if (r.checkin_en) { <div><dt>Llegó</dt><dd>{{ r.checkin_en | date: 'dd/MM/yyyy HH:mm' }}</dd></div> }
            <div><dt>Salida prevista</dt><dd>{{ salidaPrevista(r) }}</dd></div>
            <div><dt>Total de la reserva</dt><dd>{{ r.total | currency: 'USD' }}</dd></div>
          </dl>
          @if (tardia(r)) {
            <p class="sd-aviso" role="status">⚠ Ya pasó la hora de salida. Si corresponde un cargo por salida tardía, agrégalo como consumo extra.</p>
          }

          <fieldset class="sd-extras">
            <legend>1 · Consumos extra</legend>
            <p class="sd-ayuda">¿Consumió algo que no estaba incluido (minibar, restaurante, lavandería)? Agrégalo aquí. Si no, déjalo vacío y sigue.</p>
            @for (l of lineas(); track l; let i = $index) {
              <div class="sd-linea">
                <div class="sd-celda sd-item">
                  <label [for]="'sd-item-' + i">Producto</label>
                  <input type="text" [id]="'sd-item-' + i" [name]="'item' + i" class="sd-in-item" maxlength="80" placeholder="Ej. Agua, snack" autocomplete="off"
                         [(ngModel)]="l.item" [attr.aria-invalid]="errorDe(i).item ? 'true' : null" />
                  @if (errorDe(i).item; as e) { <p class="sd-error" role="alert">{{ e }}</p> }
                </div>
                <div class="sd-celda sd-cant">
                  <label [for]="'sd-cant-' + i">Cant.</label>
                  <input type="number" [id]="'sd-cant-' + i" [name]="'cant' + i" class="sd-in-cant" min="1" max="100" step="1" inputmode="numeric"
                         [(ngModel)]="l.cantidad" [attr.aria-invalid]="errorDe(i).cantidad ? 'true' : null" />
                  @if (errorDe(i).cantidad; as e) { <p class="sd-error" role="alert">{{ e }}</p> }
                </div>
                <div class="sd-celda sd-precio">
                  <label [for]="'sd-precio-' + i">Precio c/u ($)</label>
                  <input type="text" [id]="'sd-precio-' + i" [name]="'precio' + i" class="sd-in-precio" inputmode="decimal" placeholder="0.00" autocomplete="off"
                         [(ngModel)]="l.precio" [attr.aria-invalid]="errorDe(i).precio ? 'true' : null" />
                  @if (errorDe(i).precio; as e) { <p class="sd-error" role="alert">{{ e }}</p> }
                </div>
                <div class="sd-celda sd-sub">
                  <span class="sd-etiqueta">Subtotal</span>
                  <output class="sd-subtotal">{{ subtotal(l) | currency: 'USD' }}</output>
                </div>
                <button type="button" class="sd-quitar" (click)="quitar(i)" [attr.aria-label]="'Quitar el consumo ' + (i + 1)" title="Quitar">✕</button>
              </div>
            }
            @if (lineas().length < maxLineas) {
              <button type="button" class="btn btn-chico sd-agregar" (click)="agregar()">+ Agregar consumo</button>
            }
            @if (totalExtras() > 0) {
              <div class="sd-cobro">
                <p class="sd-total">Total de extras: <strong>{{ totalExtras() | currency: 'USD' }}</strong></p>
                <label for="sd-metodo">¿Cómo se cobra?</label>
                <select id="sd-metodo" name="metodo" [(ngModel)]="metodo">
                  <option value="EFECTIVO">En efectivo, en recepción</option>
                  <option value="CARGO_A_RESERVA">Cargo a la tarjeta de la reserva</option>
                </select>
                <p class="sd-ayuda">Aquí solo se registra el cobro; el pago en sí lo gestiona recepción.</p>
              </div>
            }
          </fieldset>

          <div class="sd-campo">
            <label for="sd-obs">2 · Observaciones <span class="sd-opcional">(opcional)</span></label>
            <textarea id="sd-obs" name="obs" rows="2" maxlength="300" [(ngModel)]="observaciones" placeholder="Ej. daños, objetos olvidados, salida tardía…"></textarea>
          </div>

          <div class="sd-llaves">
            <input id="sd-llaves" type="checkbox" name="llaves" [(ngModel)]="llaves" aria-describedby="sd-ayuda-llaves" />
            <label for="sd-llaves">3 · Recibí las llaves o tarjetas de acceso</label>
          </div>
          <p id="sd-ayuda-llaves" class="sd-ayuda sd-ayuda-llaves">{{ llaves ? 'Listo: ya puedes confirmar.' : 'Marca esta casilla para poder confirmar.' }}</p>

          <div class="sd-efecto" aria-live="polite">
            <strong>Al confirmar:</strong> la reserva pasa a «Completada», {{ r.habitacion_asignada || 'la unidad' }} queda «En preparación» y se avisa a Booking.
          </div>

          <div class="sd-acciones">
            <button type="button" class="btn" (click)="cerrar.emit()" [disabled]="enviando()">Todavía no</button>
            <button type="submit" class="btn btn-primario" [disabled]="!llaves || enviando()">{{ enviando() ? 'Registrando…' : 'Confirmar check-out' }}</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .sd-dialogo { border: 0; padding: 0; border-radius: var(--radio-l); box-shadow: var(--sombra-l); width: min(600px, calc(100vw - 2 * var(--gutter))); max-height: calc(100vh - 2rem); color: var(--c-texto); background: var(--c-superficie); }
    .sd-dialogo::backdrop { background: rgb(0 0 0 / .5); }
    .sd-cuerpo { padding: 1.5rem; text-align: left; }
    h2 { font-family: var(--fuente-titulos); font-weight: 400; font-size: 1.5rem; margin: 0 0 .25rem; }
    .sd-codigo { font-variant-numeric: tabular-nums; color: var(--gris-700); }
    .sd-resumen { margin: 0 0 1rem; color: var(--gris-700); }
    .sd-datos { display: grid; gap: .4rem; margin: 0 0 1rem; padding: .8rem 1rem; background: var(--c-fondo, #f6f6f4); border-radius: var(--radio-s); }
    .sd-datos div { display: flex; justify-content: space-between; gap: 1rem; }
    .sd-datos dt { color: var(--gris-700); }
    .sd-datos dd { margin: 0; font-weight: 600; text-align: right; }
    .sd-aviso { margin: 0 0 1rem; padding: .6rem .8rem; background: #fff4d6; color: #7a5200; border-radius: var(--radio-s); font-size: .9rem; }
    .sd-extras { border: 1px solid var(--gris-300, #ddd); border-radius: var(--radio-s); padding: .5rem 1rem 1rem; margin: 0 0 1rem; display: grid; gap: .75rem; }
    .sd-extras legend { font-weight: 700; padding: 0 .35rem; }
    .sd-ayuda { margin: 0; font-size: .85rem; color: var(--gris-700); }
    .sd-linea { display: grid; grid-template-columns: minmax(0, 1fr) 4.5rem 6.5rem 5rem 2rem; gap: .5rem; align-items: start; padding-bottom: .75rem; border-bottom: 1px dashed var(--gris-300, #ddd); }
    .sd-celda { display: grid; gap: .2rem; min-width: 0; }
    .sd-celda label, .sd-etiqueta { margin: 0; font-size: .8rem; font-weight: 600; color: var(--gris-700); display: block; flex-direction: row; }
    .sd-celda input { width: 100%; min-width: 0; }
    .sd-subtotal { font-weight: 600; font-variant-numeric: tabular-nums; padding-top: .55rem; display: block; }
    .sd-quitar { margin-top: 1.35rem; width: 2rem; height: 2rem; border-radius: 50%; border: 1px solid var(--gris-300, #ccc); background: transparent; color: var(--gris-700); cursor: pointer; font-size: .9rem; line-height: 1; }
    .sd-quitar:hover { background: #fde8e6; color: #8a1c13; border-color: #8a1c13; }
    .sd-agregar { justify-self: start; }
    .sd-cobro { display: grid; gap: .35rem; padding: .75rem; background: var(--c-fondo, #f6f6f4); border-radius: var(--radio-s); }
    .sd-total { margin: 0; font-size: 1.05rem; }
    .sd-cobro label { margin: 0; font-weight: 600; display: block; flex-direction: row; }
    .sd-opcional { font-weight: 400; color: var(--gris-700); }
    .sd-campo { display: grid; gap: .3rem; margin-bottom: 1rem; }
    .sd-campo label { margin: 0; font-size: 1rem; color: var(--c-texto); font-weight: 700; flex-direction: row; display: block; }
    .sd-campo textarea { width: 100%; resize: vertical; font: inherit; }
    .sd-error { margin: 0; font-size: .8rem; color: var(--c-error-texto, #b3261e); font-weight: 600; }
    .sd-llaves { display: flex; flex-direction: row; align-items: center; gap: .75rem; padding: .75rem 1rem; border: 1px solid var(--gris-300, #ccc); border-radius: var(--radio-s); }
    .sd-llaves input { width: 1.4rem; height: 1.4rem; flex: none; margin: 0; cursor: pointer; }
    .sd-llaves label { margin: 0; font-size: 1rem; font-weight: 700; color: var(--c-texto); cursor: pointer; display: block; flex-direction: row; }
    .sd-ayuda-llaves { margin: .35rem 0 0 .25rem; }
    .sd-efecto { margin-top: 1rem; padding: .7rem .9rem; background: var(--c-fondo, #f6f6f4); border-radius: var(--radio-s); font-size: .9rem; }
    .sd-acciones { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1.1rem; flex-wrap: wrap; }
    @media (max-width: 520px) {
      .sd-linea { grid-template-columns: 1fr 1fr; }
      .sd-item { grid-column: 1 / -1; }
      .sd-quitar { margin-top: 1.35rem; justify-self: end; }
    }
  `,
})
export class SalidaDialogoComponent {
  /** Reserva que sale; `null` = cerrado. */
  readonly reserva = input<ReservaHost | null>(null);
  readonly enviando = input(false);
  readonly confirmar = output<DatosSalida>();
  readonly cerrar = output<void>();

  protected readonly maxLineas = MAX_LINEAS;
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  protected readonly lineas = signal<LineaConsumo[]>([]);
  /** Errores por línea; solo aparecen tras intentar confirmar, para no regañar mientras escribe. */
  private readonly errores = signal<ErrorLinea[]>([]);
  protected metodo: 'EFECTIVO' | 'CARGO_A_RESERVA' = 'EFECTIVO';
  protected observaciones = '';
  protected llaves = false;
  private foco: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const r = this.reserva();
      const d = this.dialogo().nativeElement;
      if (r && !d.open) {
        this.foco = document.activeElement as HTMLElement | null;
        this.lineas.set([]);
        this.errores.set([]);
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

  protected salidaPrevista(r: ReservaHost): string {
    const [a, m, d] = r.fecha_salida.slice(0, 10).split('-');
    return `${d}/${m}/${a} · ${r.hora_checkout.slice(0, 5)}`;
  }

  /** ¿Ya pasó la hora de check-out del día de salida? */
  protected tardia(r: ReservaHost): boolean {
    const limite = new Date(`${r.fecha_salida.slice(0, 10)}T${r.hora_checkout.slice(0, 8)}`);
    return !Number.isNaN(limite.getTime()) && Date.now() > limite.getTime();
  }

  protected agregar(): void {
    this.lineas.update((l) => [...l, { item: '', cantidad: 1, precio: '' }]);
    // El foco va al nombre del consumo nuevo, para escribir sin tocar el mouse
    setTimeout(() => document.getElementById(`sd-item-${this.lineas().length - 1}`)?.focus());
  }

  protected quitar(i: number): void {
    this.lineas.update((l) => l.filter((_, k) => k !== i));
    this.errores.set([]);
  }

  protected errorDe(i: number): ErrorLinea {
    return this.errores()[i] ?? {};
  }

  /** Una línea con nombre y precio vacíos se ignora (se agregó sin querer). */
  private vacia = (l: LineaConsumo): boolean => !l.item.trim() && !l.precio.trim();

  protected subtotal(l: LineaConsumo): number {
    const p = leerPrecio(l.precio);
    const c = Number(l.cantidad);
    return p !== null && Number.isInteger(c) && c >= 1 ? p * c : 0;
  }

  protected totalExtras(): number {
    return this.lineas().reduce((t, l) => t + this.subtotal(l), 0);
  }

  /** Hay algo escrito que se perdería al cerrar. */
  protected hayDatos(): boolean {
    return this.lineas().some((l) => !this.vacia(l)) || this.observaciones.trim().length > 0;
  }

  protected intentarCerrar(): void {
    if (this.enviando() || this.hayDatos()) return; // con datos escritos, solo cierra «Todavía no»
    this.cerrar.emit();
  }

  protected enviar(): void {
    if (!this.llaves || this.enviando()) return;
    const errores: ErrorLinea[] = this.lineas().map((l) => {
      if (this.vacia(l)) return {};
      const e: ErrorLinea = {};
      if (!l.item.trim()) e.item = 'Escribe qué consumió.';
      const c = Number(l.cantidad);
      if (l.cantidad === null || !Number.isInteger(c) || c < 1 || c > 100) e.cantidad = 'De 1 a 100.';
      if (leerPrecio(l.precio) === null) e.precio = 'Ej. 3.50';
      return e;
    });
    this.errores.set(errores);
    if (errores.some((e) => Object.keys(e).length)) return;
    const consumos: ConsumoExtra[] = this.lineas()
      .filter((l) => !this.vacia(l))
      .map((l) => ({ item: l.item.trim(), cantidad: Number(l.cantidad), precio: (leerPrecio(l.precio) as number).toFixed(2) }));
    const obs = this.observaciones.trim();
    this.confirmar.emit({
      ...(obs ? { observaciones: obs } : {}),
      ...(consumos.length ? { consumos, metodo_pago_consumos: this.metodo } : {}),
    });
  }

  /** Clic en el fondo oscuro (fuera del cuadro) = cerrar, si no hay nada escrito. */
  protected clicFondo(ev: MouseEvent): void {
    if (ev.target === this.dialogo().nativeElement) this.intentarCerrar();
  }
}
