import { Component, input, signal } from '@angular/core';
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

/** Lista en vivo de requisitos de la clave (✓/✗). */
@Component({
  selector: 'app-requisitos-clave',
  template: `
    <ul class="requisitos-clave" [id]="id()" aria-live="polite">
      @for (r of requisitos; track r.texto) {
        <li [class.cumple]="r.cumple(valor())" [class.falta]="tocado() && !r.cumple(valor())">
          <span aria-hidden="true">{{ r.cumple(valor()) ? '✓' : tocado() ? '✗' : '○' }}</span>
          {{ r.texto }}<span class="sr-only">: {{ r.cumple(valor()) ? 'cumple' : 'falta' }}</span>
        </li>
      }
    </ul>
  `,
})
export class RequisitosClaveComponent {
  readonly valor = input('');
  /** Hasta que el campo se toca, lo pendiente se ve neutro (no como error). */
  readonly tocado = input(false);
  readonly id = input.required<string>();
  readonly requisitos = REQUISITOS_CLAVE;
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
