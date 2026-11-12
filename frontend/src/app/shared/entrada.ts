import { Directive, ElementRef, forwardRef, HostAttributeToken, HostListener, inject, input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/*
 * Filtros mientras se escribe o se pega: lo que no está permitido ni siquiera aparece en el campo.
 * Son solo ayuda de interfaz: los validadores y el backend siguen siendo la fuente de verdad.
 */

export type TipoEntrada = 'entero' | 'decimal' | 'nombre' | 'razon' | 'texto';

/** Letras (con tildes, ñ, ü), espacio, apóstrofe y guion: los caracteres de NOMBRE_PERSONA. */
const NO_NOMBRE = /[^A-Za-zÀ-ÖØ-öø-ÿ '’-]/g;
/** Razón social: lo mismo que un nombre más punto, coma y "&" (S.A., Cía. Ltda., Pérez & Hijos). */
const NO_RAZON = /[^A-Za-zÀ-ÖØ-öø-ÿ '’.,&-]/g;
/** Texto corriente de catálogo: letras, dígitos y la puntuación justa («Agua 500 ml», «Café c/leche», «Vino (copa)»). */
const NO_TEXTO = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9 '’.,&%()/-]/g;

/** Solo dígitos, recortado a `max` si se indica. */
export function filtrarEntero(v: string, max?: number): string {
  const d = v.replace(/\D/g, '');
  return max ? d.slice(0, max) : d;
}

/**
 * Número con un solo separador decimal (punto o coma; se muestra coma) y hasta `decimales` cifras después.
 * "12.5" -> "12,5" · "1,234" -> "1,23" · "1a2" -> "12" · ",5" -> "0,5"
 */
export function filtrarDecimal(v: string, decimales = 2): string {
  const limpio = v.replace(/[^\d.,]/g, '').replace(/\./g, ',');
  const i = limpio.indexOf(',');
  if (i < 0) return limpio;
  const entera = limpio.slice(0, i).replace(/,/g, '') || '0';
  const frac = limpio.slice(i + 1).replace(/,/g, '').slice(0, decimales);
  return decimales > 0 ? `${entera},${frac}` : entera;
}

/** Quita dígitos y símbolos; deja letras, espacio, apóstrofe y guion (sin espacios dobles). */
export const filtrarNombre = (v: string): string => v.replace(NO_NOMBRE, '').replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
/** Como el nombre, pero admite dígitos: para nombres de productos y servicios. */
export const filtrarTexto = (v: string): string => v.replace(NO_TEXTO, '').replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
export const filtrarRazon = (v: string): string => v.replace(NO_RAZON, '').replace(/\s{2,}/g, ' ').replace(/^\s+/, '');

/** "12,50" -> 12.5 · "" -> null (para el modelo del formulario). */
export function aNumero(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

export function filtrar(tipo: TipoEntrada, v: string, decimales = 2): string {
  switch (tipo) {
    case 'entero': return filtrarEntero(v);
    case 'decimal': return filtrarDecimal(v, decimales);
    case 'nombre': return filtrarNombre(v);
    case 'razon': return filtrarRazon(v);
    case 'texto': return filtrarTexto(v);
  }
}

/** true si escribir hasta `resultado` no mete caracteres prohibidos (en decimales, el punto cuenta como coma). */
export function permitido(tipo: TipoEntrada, resultado: string, decimales = 2): boolean {
  const esperado = tipo === 'decimal' ? resultado.replace(/\./g, ',') : resultado;
  const f = filtrar(tipo, resultado, decimales);
  return f === esperado || (tipo === 'decimal' && f === `0${esperado}`);
}

/** beforeinput: impide escribir cualquier cosa que no sea dígito (tarjeta, caducidad, CVV). El pegado lo limpia el (input). */
export function bloquearNoDigitos(ev: InputEvent): void {
  if (ev.inputType === 'insertText' && ev.data !== null && /\D/.test(ev.data)) ev.preventDefault();
}

/**
 * <input appFiltro="entero|decimal|nombre|razon" formControlName="..."> (también con ngModel).
 * - beforeinput: bloquea la tecla si el resultado tendría un carácter no permitido.
 * - input: limpia lo pegado o autocompletado.
 * - Para "entero" y "decimal" el modelo recibe number | null (no el texto), así los validadores de rango siguen igual.
 * Se usa con type="text" (no type="number", que deja pasar "e", "+" y "-") y pone el inputmode adecuado.
 */
@Directive({
  selector: 'input[appFiltro]',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => FiltroDirective), multi: true }],
  // autocomplete: respeta el del campo (given-name, family-name, organization…); 'off' solo si el campo no declara uno
  host: { '[attr.inputmode]': 'modoTeclado()', '[attr.autocomplete]': 'autocompletar' },
})
export class FiltroDirective implements ControlValueAccessor {
  readonly appFiltro = input.required<TipoEntrada>();
  readonly decimales = input(2);
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  readonly autocompletar = inject(new HostAttributeToken('autocomplete'), { optional: true }) ?? 'off';
  private alCambiar: (v: unknown) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  modoTeclado(): string {
    return this.appFiltro() === 'entero' ? 'numeric' : this.appFiltro() === 'decimal' ? 'decimal' : 'text';
  }

  private numerico(): boolean {
    return this.appFiltro() === 'entero' || this.appFiltro() === 'decimal';
  }

  @HostListener('beforeinput', ['$event'])
  antes(ev: InputEvent): void {
    if (ev.inputType !== 'insertText' || ev.data === null) return;
    const inicio = this.el.selectionStart ?? this.el.value.length;
    const fin = this.el.selectionEnd ?? inicio;
    const resultado = this.el.value.slice(0, inicio) + ev.data + this.el.value.slice(fin);
    if (!permitido(this.appFiltro(), resultado, this.decimales())) ev.preventDefault();
  }

  @HostListener('input')
  alEscribir(): void {
    const limpio = filtrar(this.appFiltro(), this.el.value, this.decimales());
    if (limpio !== this.el.value) this.el.value = limpio;
    this.alCambiar(this.numerico() ? aNumero(limpio) : limpio);
  }

  @HostListener('blur')
  alSalir(): void {
    this.alTocar();
  }

  writeValue(v: unknown): void {
    if (v === null || v === undefined || v === '') this.el.value = '';
    else this.el.value = this.appFiltro() === 'decimal' ? String(v).replace('.', ',') : String(v);
  }
  registerOnChange(fn: (v: unknown) => void): void {
    this.alCambiar = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.alTocar = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.el.disabled = disabled;
  }
}
