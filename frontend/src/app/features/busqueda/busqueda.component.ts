import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { CriteriosBusqueda, DetalleAlojamiento } from '../../core/models/api.models';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { CatalogoService } from '../../core/services/catalogo.service';
import { fechaMasDias, hoyEcuador, motivoFechas } from '../../shared/fechas';
import { aEstrellas, noches, plural, rangoCorto, textoHuespedes, textoPersonas, tituloPolitica } from '../../shared/textos';
import { AlertaErrorComponent, EstrellasComponent } from '../../shared/ui';
import { FiltroDirective } from '../../shared/entrada';
import { motivoPrecio } from '../../shared/validadores';

/** Número entero obligatorio entre min y max (huéspedes y habitaciones; el mensaje lo da motivoBusqueda). */
const entero = (min: number, max: number): ValidatorFn => (c) => {
  const n = Number(c.value);
  return c.value === null || c.value === '' || !Number.isInteger(n) || n < min || n > max ? { rango: true } : null;
};

/** Mismas reglas que el backend (/search): fechas válidas y huéspedes dentro de rango. */
export function motivoBusqueda(
  v: { checkin?: string | null; checkout?: string | null; adultos?: number | null; ninos?: number | null; habitaciones?: number | null; precio?: number | null },
  hoy: string,
): string {
  const entre = (x: unknown, min: number, max: number) => x !== null && x !== '' && Number.isInteger(Number(x)) && Number(x) >= min && Number(x) <= max;
  const f = motivoFechas(v.checkin, v.checkout, hoy);
  if (f.entrada || f.salida) return f.entrada || f.salida;
  if (!entre(v.adultos, 1, 30)) return 'Indica entre 1 y 30 adultos (número entero).';
  if (!entre(v.ninos ?? 0, 0, 10)) return 'Indica entre 0 y 10 niños (número entero).';
  if (!entre(v.habitaciones, 1, 20)) return 'Indica entre 1 y 20 habitaciones (número entero).';
  const precio = motivoPrecio(v.precio, 0.01, 100000, false);
  if (precio) return `Precio máximo: ${precio.charAt(0).toLowerCase()}${precio.slice(1)}.`;
  return '';
}

@Component({
  selector: 'app-busqueda',
  host: { '(window:resize)': 'medirCategorias()' },
  imports: [ReactiveFormsModule, RouterLink, CurrencyPipe, AlertaErrorComponent, EstrellasComponent, FiltroDirective],
  template: `
    <section class="banner" aria-labelledby="titulo-banner">
      <div class="banner-texto">
        <p class="antetitulo">Hoteles · Hostales · Cabañas · Casas</p>
        <h1 id="titulo-banner">Ecuador, a tu ritmo</h1>
        <p class="bajada">De los Andes a Galápagos, con el precio final claro antes de reservar.</p>
      </div>
      <p class="credito">Foto: Cotopaxi · Unsplash</p>
    </section>

    <form class="buscador" [formGroup]="form" (ngSubmit)="buscar()" novalidate aria-label="Buscar alojamiento">
      <div class="buscador-fila">
        <div class="campo campo-destino" role="group" aria-labelledby="et-destino">
          <span class="campo-etiqueta" id="et-destino">Destino</span>
          <div class="campo-doble">
            <select formControlName="province" aria-label="Provincia">
              <option value="">Todas</option>
              @for (p of constantes()?.provinces ?? []; track p.name) { <option [value]="p.name">{{ p.name }}</option> }
            </select>
            <select formControlName="city" aria-label="Ciudad">
              <option [ngValue]="null">Todas las ciudades</option>
              @for (c of ciudades(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
            </select>
          </div>
        </div>
        <label class="campo"><span class="campo-etiqueta">Entrada</span>
          <input type="date" formControlName="checkin" [min]="hoy" required [attr.aria-invalid]="!!fechas().entrada"
                 [attr.aria-describedby]="fechas().entrada ? 'err-checkin' : null" />
          @if (fechas().entrada) { <small class="msg-fecha" id="err-checkin" role="alert">{{ fechas().entrada }}</small> }
        </label>
        <label class="campo"><span class="campo-etiqueta">Salida</span>
          <input type="date" formControlName="checkout" [min]="form.controls.checkin.value" required [attr.aria-invalid]="!!fechas().salida"
                 [attr.aria-describedby]="fechas().salida ? 'err-checkout' : null" />
          @if (fechas().salida) { <small class="msg-fecha" id="err-checkout" role="alert">{{ fechas().salida }}</small> }
        </label>
        <div class="campo">
          <span class="campo-etiqueta" id="et-huespedes">Huéspedes</span>
          <button class="campo-boton" type="button" aria-labelledby="et-huespedes" aria-controls="panel-huespedes"
                  [attr.aria-expanded]="panelHuespedes()" (click)="panelHuespedes.set(!panelHuespedes())">{{ resumenHuespedes() }}</button>
          @if (panelHuespedes()) {
            <!-- Esc desde cualquier campo del panel lo cierra (el evento sube desde los inputs) -->
            <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
            <div class="panel-huespedes" id="panel-huespedes" (keydown.escape)="panelHuespedes.set(false)">
              @for (c of contadores; track c.campo) {
                <div class="contador-fila" role="group" [attr.aria-label]="c.etiqueta">
                  <span class="contador-icono" aria-hidden="true">
                    @switch (c.campo) {
                      @case ('adultos') {
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      }
                      @case ('ninos') {
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>
                      }
                      @default {
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v14M3 9h16a2 2 0 0 1 2 2v8M3 16h18M7 9v7"/></svg>
                      }
                    }
                  </span>
                  <span class="contador-texto">{{ c.etiqueta }}</span>
                  <span class="contador-mando">
                    <button type="button" class="contador-btn" [attr.aria-label]="'Quitar ' + c.unidad" [disabled]="valorContador(c.campo) <= c.min" (click)="ajustar(c.campo, -1)">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
                    </button>
                    <output class="contador-valor" aria-live="polite">{{ valorContador(c.campo) }}</output>
                    <button type="button" class="contador-btn" [attr.aria-label]="'Agregar ' + c.unidad" [disabled]="valorContador(c.campo) >= c.max" (click)="ajustar(c.campo, 1)">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                  </span>
                </div>
              }
              <button class="btn btn-secundario btn-chico" type="button" (click)="panelHuespedes.set(false)">Listo</button>
            </div>
          }
        </div>
        <button class="btn btn-primario btn-buscar" type="submit" [disabled]="cargando()">Buscar</button>
      </div>

      <div class="buscador-pie d-flex justify-content-between align-items-center flex-wrap gap-3 mt-2">
        <button class="btn-filtros" type="button" aria-controls="mas-filtros" [attr.aria-expanded]="masFiltros()" (click)="masFiltros.set(!masFiltros())">
          Más filtros
          @if (filtrosActivos()) { <span class="contador" [attr.aria-label]="filtrosActivos() + ' activos'">{{ filtrosActivos() }}</span> }
          <span class="flecha" aria-hidden="true">▾</span>
        </button>
        <!-- Los errores de fecha ya se muestran bajo su campo -->
        @if (problema() && !fechas().entrada && !fechas().salida) { <p class="aviso-form" role="alert" tabindex="-1">{{ problema() }}</p> }
      </div>

      @if (masFiltros()) {
        <div class="mas-filtros" id="mas-filtros">
          <label>Estrellas mín.
            <select formControlName="estrellas">
              <option [ngValue]="null">Cualquiera</option>
              @for (e of [1, 2, 3, 4, 5]; track e) { <option [ngValue]="e">{{ e }}+</option> }
            </select>
          </label>
          <label>Precio máx./noche (USD) <input appFiltro="decimal" formControlName="precio" maxlength="9" placeholder="Sin límite" /></label>
          <label>Ordenar por
            <select formControlName="orden">
              <option value="relevancia">Relevancia</option>
              <option value="precio_asc">Precio: menor a mayor</option>
              <option value="precio_desc">Precio: mayor a menor</option>
              <option value="calificacion">Mejor calificados</option>
            </select>
          </label>
        </div>
      }
    </form>

    <nav class="categorias" aria-label="Filtrar por tipo de alojamiento">
      <div class="categorias-env" [class.desborda]="catDesborda()" [class.hay-antes]="catAntes()" [class.hay-mas]="catMas()">
        @if (catAntes()) {
          <button type="button" class="cat-flecha cat-flecha-izq" aria-label="Ver tipos anteriores" (click)="desplazarCategorias(-1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
          </button>
        }
        @if (catMas()) {
          <button type="button" class="cat-flecha cat-flecha-der" aria-label="Ver más tipos" (click)="desplazarCategorias(1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        }
      <div class="categorias-fila" #filaCategorias (scroll)="medirCategorias()">
        <button type="button" class="categoria" [class.activa]="!form.controls.tipo.value" [attr.aria-pressed]="!form.controls.tipo.value" (click)="elegirTipo(null)">
          <span class="ic ic-todos" aria-hidden="true"></span><span>Todos</span>
        </button>
        @for (t of constantes()?.accommodation_types ?? []; track t.id) {
          <button type="button" class="categoria" [class.activa]="form.controls.tipo.value === t.id" [attr.aria-pressed]="form.controls.tipo.value === t.id" (click)="elegirTipo(t.id)">
            <span class="ic" [class]="'ic ' + icono(t.name)" aria-hidden="true"></span><span>{{ t.name }}</span>
          </button>
        }
      </div>
      </div>
    </nav>

    <app-alerta-error [error]="error()" />
    @if (cargando()) {
      <p class="sr-only" role="status">Buscando alojamientos…</p>
      <div class="grid-tarjetas" aria-hidden="true">
        @for (i of esqueletos; track i) {
          <div class="tarjeta-aloj esqueleto">
            <div class="tarjeta-foto"></div>
            <div class="cuerpo"><div class="linea-esq media"></div><div class="linea-esq corta"></div><div class="linea-esq"></div></div>
          </div>
        }
      </div>
    } @else if (buscado() && !resultados().length) {
      <div class="sin-resultados" role="status">
        <p class="icono" aria-hidden="true">🧭</p>
        <h2>No encontramos alojamientos</h2>
        <p>Prueba con otras fechas, otro destino o quita algunos filtros: hay mucho Ecuador por descubrir.</p>
        <button class="btn btn-secundario" type="button" (click)="quitarFiltros()">Quitar filtros</button>
      </div>
    } @else {
      @if (resultados().length) {
        <div class="resultados-cabecera d-flex justify-content-between align-items-baseline flex-wrap gap-3">
          <h2>Alojamientos disponibles</h2>
          <p>{{ resumenResultados() }}</p>
        </div>
      }
      <div class="grid-tarjetas">
        @for (a of resultados(); track a.id) {
          <article class="tarjeta-aloj">
            <a class="tarjeta-enlace" [routerLink]="['/alojamientos', a.id]">
              <div class="tarjeta-foto">
                <img [src]="a.cover_photo || 'https://placehold.co/600x400?text=Sin+foto'" alt="" loading="lazy" decoding="async" width="600" height="450" />
                <span class="tarjeta-tipo">{{ a.type }}</span>
                @if (destacado(a)) { <span class="tarjeta-favorito">Favorito de huéspedes</span> }
              </div>
              <div class="cuerpo">
                <div class="fila-titulo">
                  <h2>{{ a.name }}</h2>
                  @if (a.rating.score !== null && a.rating.reviews > 0) {
                    <span class="nota-corta" role="img" [attr.aria-label]="notaTexto(a) + ' de 5 estrellas, ' + plural(a.rating.reviews, 'reseña')">
                      <span aria-hidden="true">★ {{ notaTexto(a) }}</span>
                    </span>
                  } @else { <span class="nota-corta nuevo">Nuevo</span> }
                </div>
                <p class="ubicacion"><span>{{ a.city.name }}, {{ a.city.province }}</span></p>
                @if (a.stars || a.rating.reviews > 0) {
                  <p class="detalle-corto">@if (a.stars) { <app-estrellas [n]="a.stars" /> }@if (a.stars && a.rating.reviews > 0) { · }@if (a.rating.reviews > 0) { {{ plural(a.rating.reviews, 'reseña') }} }</p>
                }
                @if (servicios(a); as sv) { <p class="tarjeta-servicios">{{ sv }}</p> }
                @if (a.policies?.cancellation?.name; as pol) {
                  <p class="tarjeta-cancelacion" [class.sin-reembolso]="pol === 'NO_REEMBOLSABLE'">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
                    Cancelación {{ titulo(pol).toLowerCase() }}
                  </p>
                }
                @if (a.price_from) {
                  <p class="precio-noche"><strong>{{ a.price_from | currency: 'USD' }}</strong> <span>por noche</span></p>
                }
              </div>
            </a>
            <button class="corazon" type="button" [class.activo]="esFavorito(a.id)" [attr.aria-pressed]="esFavorito(a.id)"
                    [attr.aria-label]="(esFavorito(a.id) ? 'Quitar de favoritos: ' : 'Guardar en favoritos: ') + a.name" (click)="alternarFavorito(a.id)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6s-7.6-4.7-9.3-9.4C1.4 7.7 3.7 4.5 6.9 4.5c2 0 3.5 1.1 5.1 3 1.6-1.9 3.1-3 5.1-3 3.2 0 5.5 3.2 4.2 6.7-1.7 4.7-9.3 9.4-9.3 9.4z" /></svg>
            </button>
          </article>
        }
      </div>
      @if (resultados().length) {
        <nav class="paginacion d-flex justify-content-center align-items-center gap-3" aria-label="Paginación">
          <button class="btn" type="button" (click)="anterior()" [disabled]="!cursores().length">Anterior</button>
          <span>Página {{ cursores().length + 1 }}</span>
          <button class="btn" type="button" (click)="siguiente()" [disabled]="!siguientePagina()">Siguiente</button>
        </nav>
      }
    }
  `,
})
export class BusquedaComponent implements OnInit {
  private readonly catalogo = inject(CatalogoService);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Hoy en Ecuador (misma referencia que el backend), no la fecha del reloj del navegador. */
  readonly hoy = hoyEcuador();
  readonly titulo = tituloPolitica;
  readonly constantes = toSignal(this.catalogo.constantes());
  readonly resultados = signal<DetalleAlojamiento[]>([]);
  /** "10 alojamientos · 19–21 oct · 2 noches · 5 huéspedes, 3 habitaciones" (criterios de la última búsqueda). */
  readonly resumenResultados = computed(() => {
    const c = this.catalogo.criterios();
    const n = this.resultados().length;
    if (!c) return plural(n, 'alojamiento');
    const huespedes = c.guests.number_of_adults + (c.guests.children?.length ?? 0);
    return [plural(n, 'alojamiento'), rangoCorto(c.checkin, c.checkout), plural(noches(c.checkin, c.checkout), 'noche'),
      textoHuespedes(huespedes, c.guests.number_of_rooms, ', ')].join(' · ');
  });
  readonly cargando = signal(false);
  readonly buscado = signal(false);

  // Fila de tipos de alojamiento: se avisa cuando sigue hacia los lados
  private readonly filaCategorias = viewChild<ElementRef<HTMLDivElement>>('filaCategorias');
  readonly catAntes = signal(false);
  readonly catMas = signal(false);
  /** La fila no cabe entera: se reserva sitio a los lados para que las flechas no tapen un tipo. */
  readonly catDesborda = signal(false);
  /** Hasta tres comodidades para la tarjeta ("Wi-Fi · Desayuno · Parqueadero"); vacio si no hay. */
  servicios(a: DetalleAlojamiento): string {
    const f = (a.facilities ?? []).slice(0, 3).map((x) => x.name);
    return f.join(' · ');
  }

  /** Recalcula si la fila de tipos tiene contenido fuera de la vista (al desplazar, al redimensionar y al cargar los tipos). */
  medirCategorias(): void {
    const el = this.filaCategorias()?.nativeElement;
    if (!el) return;
    this.catDesborda.set(el.scrollWidth > el.clientWidth + 4);
    this.catAntes.set(el.scrollLeft > 4);
    this.catMas.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  /** Desplaza la fila de tipos ~80 % del ancho visible (botones de flecha). */
  desplazarCategorias(dir: number): void {
    const el = this.filaCategorias()?.nativeElement;
    if (!el) return;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: suave ? 'smooth' : 'auto' });
  }

  readonly error = signal<ErrorVista | null>(null);
  readonly siguientePagina = signal<string | null>(null);
  /** Cursores de las páginas anteriores (para "Anterior"). */
  readonly cursores = signal<(string | undefined)[]>([]);
  private paginaActual: string | undefined;

  constructor() {
    // Los tipos llegan del API: se mide cuando ya están pintados
    effect(() => {
      if (this.constantes()) setTimeout(() => this.medirCategorias());
    });
  }

  readonly form = inject(FormBuilder).group({
    province: [''],
    city: [null as number | null],
    checkin: [fechaMasDias(14), Validators.required],
    checkout: [fechaMasDias(16), Validators.required],
    adultos: [2, entero(1, 30)],
    ninos: [0, entero(0, 10)],
    habitaciones: [1, entero(1, 20)],
    tipo: [null as number | null],
    precio: [null as number | null],
    estrellas: [null as number | null],
    orden: ['relevancia' as NonNullable<CriteriosBusqueda['sort_by']>],
  }, { validators: (g) => (motivoBusqueda(g.getRawValue(), this.hoy) ? { busqueda: true } : null) });

  /** Qué corregir antes de buscar (fechas y huéspedes); '' si todo está bien. */
  readonly problema = computed(() => motivoBusqueda(this.valores(), this.hoy));
  readonly fechas = computed(() => motivoFechas(this.valores().checkin, this.valores().checkout, this.hoy));

  private readonly provincia = toSignal(this.form.controls.province.valueChanges, { initialValue: '' });
  readonly ciudades = computed(() => {
    const p = this.provincia();
    return (this.constantes()?.cities ?? []).filter((c) => !p || c.province === p);
  });

  // Estado solo de interfaz (no cambia los criterios ni la llamada al API)
  readonly masFiltros = signal(false);
  readonly panelHuespedes = signal(false);
  /** Filas del panel de huéspedes: mismos límites que valida motivoBusqueda y el backend. */
  readonly contadores = [
    { campo: 'adultos', etiqueta: 'Adultos', unidad: 'adulto', min: 1, max: 30 },
    { campo: 'ninos', etiqueta: 'Niños', unidad: 'niño', min: 0, max: 10 },
    { campo: 'habitaciones', etiqueta: 'Habitaciones', unidad: 'habitación', min: 1, max: 20 },
  ] as const;
  valorContador(campo: 'adultos' | 'ninos' | 'habitaciones'): number {
    return Number(this.valores()[campo]) || 0;
  }
  ajustar(campo: 'adultos' | 'ninos' | 'habitaciones', paso: number): void {
    const c = this.contadores.find((x) => x.campo === campo)!;
    const nuevo = Math.min(c.max, Math.max(c.min, this.valorContador(campo) + paso));
    this.form.controls[campo].setValue(nuevo);
    this.form.controls[campo].markAsDirty();
  }
  readonly esqueletos = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly plural = plural;

  // ---- Presentación (no cambia criterios ni llamadas al API) ----
  /** Favoritos: solo en este navegador (localStorage); si no está disponible, viven en memoria. */
  private static readonly CLAVE_FAVORITOS = 'posadaec.favoritos';
  readonly favoritos = signal<number[]>(BusquedaComponent.leerFavoritos());

  private static leerFavoritos(): number[] {
    try {
      const v = JSON.parse(localStorage.getItem(BusquedaComponent.CLAVE_FAVORITOS) ?? '[]');
      return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
    } catch {
      return [];
    }
  }

  esFavorito(id: number): boolean {
    return this.favoritos().includes(id);
  }

  alternarFavorito(id: number): void {
    this.favoritos.update((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
    try {
      localStorage.setItem(BusquedaComponent.CLAVE_FAVORITOS, JSON.stringify(this.favoritos()));
    } catch {
      /* sin almacenamiento: queda solo en memoria */
    }
  }

  /** "Favorito de huéspedes": nota muy alta con reseñas suficientes. */
  destacado(a: DetalleAlojamiento): boolean {
    return (a.rating.score ?? 0) >= 9 && a.rating.reviews >= 20;
  }

  notaTexto(a: DetalleAlojamiento): string {
    const n = aEstrellas(a.rating.score ?? 0);
    return n.toLocaleString('es-EC', { minimumFractionDigits: n % 1 ? 1 : 0 });
  }

  /** Clase del ícono de la franja de categorías según el nombre del tipo. */
  icono(nombre: string): string {
    const n = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (n.includes('hostal') || n.includes('hostel')) return 'ic-hostal';
    if (n.includes('caba') || n.includes('glamping') || n.includes('lodge')) return 'ic-cabana';
    if (n.includes('casa') || n.includes('villa')) return 'ic-casa';
    if (n.includes('depart') || n.includes('apart') || n.includes('suite')) return 'ic-depto';
    if (n.includes('hotel') || n.includes('hosteria') || n.includes('resort')) return 'ic-hotel';
    return 'ic-pin';
  }

  /** Un toque en la franja filtra por tipo (el mismo filtro de "Más filtros"). */
  elegirTipo(id: number | null): void {
    this.form.controls.tipo.setValue(id);
    this.buscar();
  }
  private readonly valores = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly resumenHuespedes = computed(() => {
    const v = this.valores();
    const adultos = Number(v.adultos) || 0;
    const ninos = Number(v.ninos) || 0;
    const hab = Number(v.habitaciones) || 0;
    return `${textoPersonas(adultos, ninos)} · ${plural(hab, 'habitación', 'habitaciones')}`;
  });
  /** Filtros de "Más filtros" con valor distinto al predeterminado. */
  readonly filtrosActivos = computed(() => {
    const v = this.valores();
    return [v.tipo, v.estrellas, v.precio, v.orden !== 'relevancia' ? v.orden : null].filter((x) => x !== null && x !== undefined).length;
  });

  ngOnInit(): void {
    const previos = this.catalogo.criterios();
    if (previos) {
      this.form.patchValue({
        province: previos.province ?? '', city: previos.city ?? null, checkin: previos.checkin, checkout: previos.checkout,
        adultos: previos.guests.number_of_adults, ninos: previos.guests.children?.length ?? 0,
        habitaciones: previos.guests.number_of_rooms, tipo: previos.accommodation_type ?? null,
        precio: previos.max_price ?? null, estrellas: previos.min_stars ?? null,
        orden: previos.sort_by ?? 'relevancia',
      });
    }
    this.form.controls.province.valueChanges.subscribe(() => this.form.controls.city.setValue(null));
    this.buscar();
  }

  buscar(): void {
    this.panelHuespedes.set(false);
    // El boton queda activo aunque falte algo: al pulsarlo se lleva el foco a lo que hay que corregir
    if (this.form.invalid) {
      setTimeout(() => {
        const raiz = this.raiz.nativeElement;
        (raiz.querySelector<HTMLElement>('[aria-invalid="true"]') ?? raiz.querySelector<HTMLElement>('.aviso-form'))?.focus();
      });
      return;
    }
    this.cursores.set([]);
    this.cargar(undefined);
  }

  /** Vuelve destino y "Más filtros" a sus valores iniciales (conserva fechas y huéspedes) y busca de nuevo. */
  quitarFiltros(): void {
    this.form.patchValue({ province: '', city: null, tipo: null, precio: null, estrellas: null, orden: 'relevancia' });
    this.buscar();
  }

  siguiente(): void {
    const sig = this.siguientePagina();
    if (!sig) return;
    this.cursores.update((c) => [...c, this.paginaActual]);
    this.cargar(sig);
  }

  anterior(): void {
    const c = [...this.cursores()];
    const previo = c.pop();
    this.cursores.set(c);
    this.cargar(previo);
  }

  private criterios(): CriteriosBusqueda {
    const v = this.form.getRawValue();
    const c: CriteriosBusqueda = {
      checkin: v.checkin ?? '',
      checkout: v.checkout ?? '',
      guests: {
        number_of_adults: Number(v.adultos),
        number_of_rooms: Number(v.habitaciones),
        ...(Number(v.ninos) > 0 ? { children: Array(Number(v.ninos)).fill(8) } : {}),
      },
      sort_by: v.orden ?? 'relevancia',
    };
    if (v.province) c.province = v.province;
    if (v.city) c.city = v.city;
    if (v.tipo) c.accommodation_type = v.tipo;
    if (v.precio) c.max_price = Number(v.precio);
    if (v.estrellas) c.min_stars = v.estrellas;
    return c;
  }

  private cargar(page: string | undefined): void {
    if (this.form.invalid) return; // el aviso explica qué corregir; no se llama al API con criterios inválidos
    const c = this.criterios();
    this.catalogo.criterios.set(c);
    this.paginaActual = page;
    this.cargando.set(true);
    this.error.set(null);
    let orden: number[] = [];
    this.catalogo
      .buscar(c, page)
      .pipe(
        switchMap((r) => {
          this.siguientePagina.set(r.next_page);
          orden = r.data.map((d) => d.id);
          return this.catalogo.detalles(orden, ['facilities', 'policies']);
        }),
      )
      .subscribe({
        next: (detalles) => {
          // /details devuelve por código; se respeta el orden de /search
          this.resultados.set([...detalles].sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id)));
          this.cargando.set(false);
          this.buscado.set(true);
        },
        error: (e) => {
          this.error.set(leerError(e));
          this.resultados.set([]);
          this.cargando.set(false);
        },
      });
  }
}
