import { Component, computed, input, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { mensajeDe, REQUISITOS_CLAVE } from './validadores';

/** true cuando el campo ya fue tocado (blur o envío) y tiene error: así no se marcan campos que el usuario no ha visitado. */
export const conError = (c: AbstractControl | null): boolean => !!c && c.invalid && c.touched;

/**
 * Mensaje bajo un campo: rojo con icono si está mal (role="alert"), verde "Correcto" si está bien y tiene valor.
 * El `id` es el que el input referencia con aria-describedby.
 */
@Component({
  selector: 'app-campo-mensaje',
  template: `
    @if (control(); as c) {
      @if (c.invalid && c.touched) {
        <p class="msg-campo msg-error" [id]="id()" role="alert"><span aria-hidden="true">✗</span> {{ mensaje(c) }}</p>
      } @else if (c.valid && c.touched && conValor(c) && mostrarOk()) {
        <p class="msg-campo msg-ok" [id]="id()"><span aria-hidden="true">✓</span> Correcto</p>
      }
    }
  `,
})
export class CampoMensajeComponent {
  readonly control = input.required<AbstractControl | null>();
  readonly id = input.required<string>();
  readonly mostrarOk = input(true);
  mensaje = mensajeDe;
  conValor(c: AbstractControl): boolean {
    return c.value !== null && c.value !== undefined && `${c.value}`.trim() !== '';
  }
}

/** Medidor en vivo de la clave: 4 barras (una por requisito cumplido) y qué falta. */
@Component({
  selector: 'app-requisitos-clave',
  template: `
    <div class="medidor-clave" [id]="id()" aria-live="polite">
      <div class="medidor-barras" aria-hidden="true">
        @for (r of requisitos; track r.texto; let i = $index) {
          <span [class.on]="i < cumplidos()" [attr.data-nivel]="nivel()"></span>
        }
      </div>
      <p class="medidor-texto" [attr.data-nivel]="nivel()">
        <strong>{{ etiqueta() }}</strong>
        @if (faltan().length && (tocado() || valor())) { · Falta: {{ faltan().join(', ') }} }
      </p>
    </div>
  `,
})
export class RequisitosClaveComponent {
  readonly valor = input('');
  /** Hasta que el campo se toca, lo pendiente se ve neutro (no como error). */
  readonly tocado = input(false);
  readonly id = input.required<string>();
  readonly requisitos = REQUISITOS_CLAVE;
  readonly cumplidos = computed(() => this.requisitos.filter((r) => r.cumple(this.valor())).length);
  readonly nivel = computed(() => (this.cumplidos() === 4 ? 'ok' : this.cumplidos() === 3 ? 'medio' : this.valor() ? 'bajo' : 'vacio'));
  readonly etiqueta = computed(() => ({ ok: 'Clave válida', medio: 'Casi lista', bajo: 'Clave débil', vacio: 'Escribe tu clave' })[this.nivel()]);
  readonly faltan = computed(() => this.requisitos.filter((r) => !r.cumple(this.valor())).map((r) => r.texto.toLowerCase()));
}

/** Input de clave con botón de ojo para mostrar/ocultar. Se usa con un <input> proyectado. */
@Component({
  selector: 'app-ojo-clave',
  template: `
    <div class="input-clave">
      <ng-content />
      <button type="button" class="btn-ojo" (click)="alternar()" [attr.aria-pressed]="visible()"
              [attr.aria-label]="visible() ? 'Ocultar clave' : 'Mostrar clave'" [title]="visible() ? 'Ocultar clave' : 'Mostrar clave'">
        @if (visible()) {
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-3.1 3.9M6.3 7.6A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
        } @else {
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6S3.5 14 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>
        }
      </button>
    </div>
  `,
})
export class OjoClaveComponent {
  readonly visible = signal(false);
  /** El componente padre lee `visible()` para poner type="text" o "password". */
  alternar(): void {
    this.visible.update((v) => !v);
  }
}
