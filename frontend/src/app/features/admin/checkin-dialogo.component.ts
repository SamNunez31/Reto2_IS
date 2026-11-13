import { CurrencyPipe } from '@angular/common';
import { Component, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FiltroDirective } from '../../shared/entrada';
import { ReservaHost, SugerenciaHabitacion } from '../../core/services/anfitrion.service';
import { plural, rangoLargo } from '../../shared/textos';

export interface DatosCheckin {
  huespedes_reales: number;
  observaciones?: string;
  /** Cambio excepcional: otra habitación libre del mismo tipo */
  habitacion_id?: string;
  /** Por qué no se entrega la habitación asignada */
  motivo_cambio?: string;
}

/**
 * Diálogo «Registrar check-in» del panel de administración: muestra los datos del huésped y de la estadía
 * y pide lo que recepción confirma al recibirlo. <dialog> modal: foco atrapado, fondo inerte, Esc = cerrar.
 */
@Component({
  selector: 'app-checkin-dialogo',
  imports: [FormsModule, CurrencyPipe, FiltroDirective],
  template: `
    <!-- Clic en el fondo = cerrar; con teclado se cierra con Esc (evento cancel del <dialog>) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialogo class="ck-dialogo" aria-modal="true" aria-labelledby="ck-titulo" aria-describedby="ck-resumen"
            (cancel)="$event.preventDefault(); cerrar.emit()" (click)="clicFondo($event)">
      @if (reserva(); as r) {
        <form class="ck-cuerpo" (ngSubmit)="enviar()" novalidate>
          <h2 id="ck-titulo">Registrar check-in · <span class="ck-codigo">{{ r.codigo }}</span></h2>
          <p id="ck-resumen" class="ck-resumen">{{ titular(r) }} · {{ r.alojamiento }} · {{ rango(r) }}</p>

          <dl class="ck-datos">
            <div><dt>Titular de la reserva</dt><dd>{{ titular(r) }}</dd></div>
            @if (r.titular_identificacion) {
              <div><dt>{{ tipoDoc(r) }}</dt><dd class="ck-doc">{{ r.titular_identificacion }}</dd></div>
            }
            <div><dt>Alojamiento</dt><dd>{{ r.alojamiento }}</dd></div>
            <div><dt>Estadía</dt><dd>{{ rango(r) }}</dd></div>
            @if (numerada() && r.habitacion_asignada) {
              <div>
                <dt>Habitación</dt>
                <dd>
                  {{ cambio ? etiquetaCambio(r) : r.habitacion_asignada }}
                  @if (!cambio && libres().length) {
                    <button type="button" class="ck-enlace" (click)="abrirCambio()">cambiar</button>
                  }
                </dd>
              </div>
            }
            <div><dt>Huéspedes reservados</dt><dd>{{ personas(r.num_huespedes) }}</dd></div>
            <div><dt>Total de la reserva</dt><dd>{{ r.total | currency: 'USD' }}</dd></div>
          </dl>

          @if (cambio) {
            <fieldset class="ck-cambio">
              <legend>Cambio de habitación</legend>
              <div class="ck-campo">
                <label for="ck-hab">Nueva habitación</label>
                <select id="ck-hab" name="hab" [(ngModel)]="habitacion">
                  @for (h of libres(); track h.id) { <option [value]="h.id">Habitación {{ h.numero }}</option> }
                </select>
              </div>
              <div class="ck-campo">
                <label for="ck-motivo">Motivo</label>
                <input id="ck-motivo" name="motivo" type="text" maxlength="200" appFiltro="texto" placeholder="Ej. aire acondicionado averiado" [(ngModel)]="motivo" />
                @if (errorMotivo()) { <p class="ck-error" role="alert">{{ errorMotivo() }}</p> }
              </div>
              <button type="button" class="ck-enlace" (click)="cancelarCambio()">Dejar la habitación asignada</button>
            </fieldset>
          }

          <div class="ck-campo">
            <label for="ck-reales">Huéspedes que llegaron</label>
            <input id="ck-reales" name="reales" type="text" appFiltro="entero" maxlength="2" [(ngModel)]="reales"
                   [attr.aria-invalid]="errorReales() ? 'true' : null" [attr.aria-describedby]="errorReales() ? 'ck-error-reales' : null" />
            @if (errorReales(); as e) { <p id="ck-error-reales" class="ck-error" role="alert">{{ e }}</p> }
            @if (extra(r) > 0) {
              <div class="ck-extra" role="status">
                <p class="ck-extra-titulo">Llegaron {{ personas(extra(r)) }} más de los {{ r.num_huespedes }} reservados.</p>
                @if (sugerencias().length) {
                  <p>Estas habitaciones siguen libres para {{ rangoLargoTexto(r) }}:</p>
                  <ul class="ck-sugerencias">
                    @for (s of sugerencias(); track s.codigo_tipo) {
                      <li>
                        <strong>{{ s.nombre }}</strong> · hasta {{ personas(s.capacidad) }} ·
                        {{ s.precio_noche | currency: 'USD' }}/noche · {{ s.libres }} libre{{ s.libres === 1 ? '' : 's' }}
                      </li>
                    }
                  </ul>
                  @if (enlaceReserva(r); as enlace) {
                    <a class="btn btn-chico btn-primario" [href]="enlace" target="_blank" rel="noopener">Reservar otra habitación</a>
                  }
                } @else {
                  <p>No quedan habitaciones libres para esas fechas en este alojamiento.</p>
                }
              </div>
            }
          </div>

          <div class="ck-campo">
            <label for="ck-obs">Observaciones <span class="ck-opcional">(opcional)</span></label>
            <textarea id="ck-obs" name="obs" rows="3" maxlength="300" [(ngModel)]="observaciones" aria-describedby="ck-contador"
                      placeholder="Ej. llegada tardía, solicita cuna, equipaje en custodia…"></textarea>
            <p id="ck-contador" class="ck-ayuda">{{ observaciones.length }}/300</p>
          </div>

          <label class="ck-verificado">
            <input type="checkbox" name="verificado" [(ngModel)]="verificado" aria-describedby="ck-ayuda-verif" />
            <span>Verifiqué el documento de identidad del titular{{ r.titular_identificacion ? ' (' + r.titular_identificacion + ')' : '' }}</span>
          </label>
          <p id="ck-ayuda-verif" class="ck-ayuda">
            {{ verificado ? (r.canal_booking ? 'Al confirmar la unidad quedará ocupada y se avisará a Booking.' : 'Al confirmar la unidad quedará ocupada.') : 'Marca esta casilla para poder confirmar.' }}
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
    .ck-campo label { margin: 0; font-size: 1rem; color: var(--c-texto); font-weight: 600; flex-direction: row; display: block; }
    .ck-doc { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .ck-opcional { font-weight: 400; color: var(--gris-700); }
    .ck-campo input { width: 8rem; }
    .ck-campo select { width: 100%; }
    .ck-campo textarea { width: 100%; resize: vertical; font: inherit; }
    .ck-ayuda { margin: 0; font-size: .85rem; color: var(--gris-700); }
    .ck-enlace { border: 0; background: none; padding: 0 0 0 .4rem; font: inherit; font-size: .85rem; color: var(--c-primario, #b4521f); text-decoration: underline; cursor: pointer; }
    .ck-cambio { border: 1px solid var(--gris-300, #ddd); border-radius: var(--radio-s); padding: .5rem .9rem .9rem; margin: 0 0 .9rem; display: grid; gap: .5rem; }
    .ck-cambio legend { font-weight: 700; padding: 0 .3rem; }
    .ck-cambio select, .ck-cambio input { width: 100%; }
    .ck-cambio .ck-enlace { justify-self: start; padding: 0; }
    .ck-extra { margin: .5rem 0 0; padding: .7rem .9rem; background: #fff4d6; color: #7a5200; border-radius: var(--radio-s); font-size: .875rem; display: grid; gap: .4rem; }
    .ck-extra p { margin: 0; }
    .ck-extra-titulo { font-weight: 700; }
    .ck-sugerencias { margin: 0; padding-left: 1.1rem; display: grid; gap: .2rem; }
    .ck-extra .btn { justify-self: start; }
    .ck-error { margin: 0; font-size: .875rem; color: var(--c-error-texto, #b3261e); font-weight: 600; }
    .ck-verificado { display: flex; flex-direction: row; align-items: flex-start; gap: .6rem; font-size: 1rem; color: var(--c-texto); font-weight: 600; cursor: pointer; margin: .4rem 0 0; }
    .ck-verificado input { width: 1.25rem; height: 1.25rem; margin-top: .1rem; flex: none; }
    .ck-verificado + .ck-ayuda { margin: .25rem 0 0 1.85rem; }
    .ck-acciones { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1.1rem; flex-wrap: wrap; }
  `,
})
export class CheckinDialogoComponent {
  /** Reserva a registrar; `null` = cerrado. */
  readonly reserva = input<ReservaHost | null>(null);
  readonly enviando = input(false);
  /** null = aún cargando o no es hotel; en hoteles, las habitaciones libres del tipo reservado */
  /** El alojamiento tiene más de una unidad: solo entonces se muestra y se puede cambiar la habitación */
  readonly numerada = input(false);
  /** Otras habitaciones libres del mismo tipo */
  readonly libres = input<{ id: string; numero: string }[]>([]);
  /** Tipos que siguen libres esas fechas, para los huéspedes que llegaron de más */
  readonly sugerencias = input<SugerenciaHabitacion[]>([]);
  readonly esHotel = input(false);
  /** Código del alojamiento, para abrir su anuncio y hacer la reserva adicional */
  readonly alojamientoCodigo = input<number | null>(null);
  readonly confirmar = output<DatosCheckin>();
  readonly cerrar = output<void>();

  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  protected reales: number | null = 1;
  protected observaciones = '';
  protected verificado = false;
  protected cambio = false;
  protected habitacion = '';
  protected motivo = '';
  protected readonly errorMotivo = signal<string | null>(null);
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
        this.cambio = false;
        this.habitacion = '';
        this.motivo = '';
        this.errorMotivo.set(null);
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
  protected titular = (r: ReservaHost): string => r.titular_nombre || r.huesped;
  protected tipoDoc = (r: ReservaHost): string =>
    ({ CEDULA: 'Cédula', PASAPORTE: 'Pasaporte', RUC: 'RUC' })[r.titular_tipo_documento ?? ''] ?? 'Documento';
  protected personas = (n: number): string => plural(n, 'huésped', 'huéspedes');
  /** Huéspedes por encima de los reservados (0 si coinciden o si el campo está vacío). */
  /** Enlace al anuncio con las fechas de la estadía ya puestas, para hacer la reserva adicional. */
  protected enlaceReserva(r: ReservaHost): string | null {
    const c = this.alojamientoCodigo();
    if (c === null) return null;
    const p = new URLSearchParams({ checkin: r.fecha_entrada.slice(0, 10), checkout: r.fecha_salida.slice(0, 10), adultos: String(this.extra(r)) });
    return `/alojamientos/${c}?${p.toString()}`;
  }

  protected rangoLargoTexto = (r: ReservaHost): string => rangoLargo(r.fecha_entrada, r.fecha_salida);

  protected extra = (r: ReservaHost): number => Math.max(0, Number(this.reales ?? 0) - r.num_huespedes);

  protected abrirCambio(): void {
    this.cambio = true;
    this.habitacion = this.libres()[0]?.id ?? '';
  }

  protected cancelarCambio(): void {
    this.cambio = false;
    this.habitacion = '';
    this.motivo = '';
    this.errorMotivo.set(null);
  }

  /** Lo que se entregará si se confirma el cambio. */
  protected etiquetaCambio(r: ReservaHost): string {
    const h = this.libres().find((x) => x.id === this.habitacion);
    return h ? `Habitación ${h.numero} (en vez de ${r.habitacion_asignada})` : (r.habitacion_asignada ?? '');
  }

  protected enviar(): void {
    if (!this.verificado || this.enviando()) return;
    const n = Number(this.reales);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      this.errorReales.set('Indica un número entero de huéspedes entre 1 y 30.');
      document.getElementById('ck-reales')?.focus();
      return;
    }
    this.errorReales.set(null);
    const motivo = this.motivo.trim();
    if (this.cambio && !motivo) {
      this.errorMotivo.set('Escribe por qué no se entrega la habitación asignada.');
      document.getElementById('ck-motivo')?.focus();
      return;
    }
    this.errorMotivo.set(null);
    const obs = this.observaciones.trim();
    this.confirmar.emit({
      huespedes_reales: n,
      ...(obs ? { observaciones: obs } : {}),
      ...(this.cambio && this.habitacion ? { habitacion_id: this.habitacion, motivo_cambio: motivo } : {}),
    });
  }

  /** Clic en el fondo oscuro (fuera del cuadro) = cerrar. */
  protected clicFondo(ev: MouseEvent): void {
    if (ev.target === this.dialogo().nativeElement) this.cerrar.emit();
  }
}
