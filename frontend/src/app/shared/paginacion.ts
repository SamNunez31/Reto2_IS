import { Component, computed, input } from '@angular/core';
import { Signal } from '@angular/core';
import { signal } from '@angular/core';

/**
 * Paginación en pantalla de una lista ya cargada: muestra `tam` filas por página,
 * nunca queda fuera de rango si la lista se acorta (p. ej. tras una cancelación)
 * y se reinicia con `reiniciar()` al cambiar de filtro o de pestaña.
 */
export class Paginacion<T> {
  private readonly pedida = signal(0);
  private readonly origen: () => readonly T[];
  readonly tam: number;
  readonly total: Signal<number>;
  readonly paginas: Signal<number>;
  readonly actual: Signal<number>;
  readonly items: Signal<T[]>;

  constructor(origen: () => readonly T[], tam = 10) {
    this.origen = origen;
    this.tam = tam;
    this.total = computed(() => this.origen().length);
    this.paginas = computed(() => Math.max(1, Math.ceil(this.total() / this.tam)));
    this.actual = computed(() => Math.min(this.pedida(), this.paginas() - 1));
    this.items = computed(() => {
      const desde = this.actual() * this.tam;
      return this.origen().slice(desde, desde + this.tam);
    });
  }

  mover(d: number): void {
    this.pedida.set(Math.max(0, Math.min(this.actual() + d, this.paginas() - 1)));
  }

  reiniciar(): void {
    this.pedida.set(0);
  }
}

/** Botones Anterior / Siguiente con el contador. No se muestra si todo cabe en una página. */
@Component({
  selector: 'app-paginador',
  template: `
    @if (pag().paginas() > 1) {
      <nav class="paginacion paginador d-flex justify-content-center align-items-center gap-3" [attr.aria-label]="'Paginación de ' + unidad()">
        <button class="btn" type="button" (click)="pag().mover(-1)" [disabled]="pag().actual() === 0">Anterior</button>
        <span>Página {{ pag().actual() + 1 }} de {{ pag().paginas() }} · {{ pag().total() }} {{ unidad() }}</span>
        <button class="btn" type="button" (click)="pag().mover(1)" [disabled]="pag().actual() >= pag().paginas() - 1">Siguiente</button>
      </nav>
    }
  `,
  styles: `.paginador { margin-top: 1.25rem; flex-wrap: wrap; }`,
})
export class PaginadorComponent {
  readonly pag = input.required<Paginacion<unknown>>();
  readonly unidad = input('registros');
}
