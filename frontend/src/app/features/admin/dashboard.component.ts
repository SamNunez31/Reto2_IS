import { CurrencyPipe, PercentPipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { enVivo } from '../../shared/en-vivo';
import { RouterLink } from '@angular/router';
import * as L from 'leaflet';
import { EMPTY, expand, forkJoin, map, of, reduce, switchMap } from 'rxjs';
import { DetalleAlojamiento } from '../../core/models/api.models';
import { AdminService, Indicadores } from '../../core/services/admin.service';
import { AnfitrionService, ReservaHost } from '../../core/services/anfitrion.service';
import { leerError } from '../../core/services/api-base';
import { CatalogoService } from '../../core/services/catalogo.service';
import { CalificacionComponent } from '../../shared/calificacion';
import { aEstrellas, plural } from '../../shared/textos';
import { CargandoComponent } from '../../shared/ui';

type Estado = 'cargando' | 'listo' | 'error';
interface VentaCiudad { ciudad: string; provincia: string; reservas: number; volumen: number }
interface VentaMes { clave: string; etiqueta: string; etiquetaLarga: string; reservas: number; volumen: number }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const usdCorto = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' });

/** Geometría del gráfico de ventas por mes (unidades del viewBox; el SVG se escala al ancho disponible). */
const G = { ancho: 960, alto: 320, izq: 130, der: 44, arr: 40, aba: 56 };

/** Escala "redonda" para el eje Y: 0 → máximo bonito, 4 divisiones. */
export function escalaBonita(max: number): number[] {
  if (max <= 0) return [0, 25, 50, 75, 100];
  const paso = Math.pow(10, Math.floor(Math.log10(max / 4)));
  const multiplo = [1, 2, 2.5, 5, 10].find((m) => (m * paso * 4) >= max) ?? 10;
  return [0, 1, 2, 3, 4].map((i) => i * multiplo * paso);
}

/** Barra con solo los extremos de datos redondeados (4 px), anclada a la base. */
function barra(x: number, y: number, w: number, base: number): string {
  const h = base - y;
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`;
}

/**
 * Dashboard del ADMIN: KPI, mejor reseñados, ventas por ciudad y por mes, y mapa de alojamientos publicados.
 * Solo lectura sobre endpoints existentes: /admin/indicators, /admin/sales-by-city, /admin/accommodations,
 * /host/orders (ventas por mes, agregadas aquí) y POST /details del contrato (calificación y ubicación).
 */
@Component({
  selector: 'app-dashboard-admin',
  imports: [CurrencyPipe, PercentPipe, RouterLink, CalificacionComponent, CargandoComponent],
  template: `
    <!-- 1. KPI -->
    <section aria-labelledby="t-kpi">
      <h2 id="t-kpi" class="sr-only">Indicadores clave</h2>
      @switch (estadoKpi()) {
        @case ('cargando') { <app-cargando texto="Cargando indicadores…" /> }
        @case ('error') { <p class="alerta alerta-error" role="alert">No se pudieron cargar los indicadores: {{ errorKpi() }} <button class="btn btn-chico" type="button" (click)="cargarKpi()">Reintentar</button></p> }
        @default {
          @if (kpi(); as k) {
            <div class="kpis dash-kpis">
              <div class="kpi"><div class="valor">{{ k.confirmadas }}</div><div class="etiqueta">Reservas confirmadas</div></div>
              <div class="kpi"><div class="valor">{{ k.ventas | currency: 'USD' : 'symbol' : '1.0-0' }}</div><div class="etiqueta">Ventas totales <small>(confirmadas + completadas)</small></div></div>
              <div class="kpi"><div class="valor">{{ k.ticket === null ? '—' : (k.ticket | currency: 'USD') }}</div><div class="etiqueta">Ticket promedio <small>({{ plural(k.vendidas, 'reserva') }})</small></div></div>
              <div class="kpi"><div class="valor">{{ k.tasaCancelacion === null ? '—' : (k.tasaCancelacion | percent: '1.0-1') }}</div><div class="etiqueta">Tasa de cancelación <small>({{ k.canceladas }} de {{ k.vendidas + k.canceladas }})</small></div></div>
              <div class="kpi"><div class="valor">{{ k.publicados }}</div><div class="etiqueta">Alojamientos publicados</div></div>
              <div class="kpi"><div class="valor">{{ k.usuarios }}</div><div class="etiqueta">Usuarios activos</div></div>
            </div>
          }
        }
      }
    </section>

    <div class="dos-columnas mt">
      <!-- 2. Mejor reseñados -->
      <section class="tarjeta" aria-labelledby="t-ranking">
        <h2 id="t-ranking">Mejor reseñados</h2>
        <p class="ayuda">Top 5 alojamientos publicados por nota media (estrellas = nota ÷ 2).</p>
        @switch (estadoAloj()) {
          @case ('cargando') { <app-cargando texto="Cargando alojamientos…" /> }
          @case ('error') { <p class="alerta alerta-error" role="alert">No se pudo cargar el ranking: {{ errorAloj() }}</p> }
          @default {
            <ol class="ranking">
              @for (a of ranking(); track a.id; let i = $index) {
                <li>
                  <span class="pos" aria-hidden="true">{{ i + 1 }}</span>
                  <span class="ranking-nombre"><a [routerLink]="['/alojamientos', a.id]">{{ a.name }}</a><small>{{ a.city.name }}</small></span>
                  <app-calificacion [nota]="a.rating.score" [resenas]="a.rating.reviews" [chica]="true" />
                </li>
              } @empty { <li class="vacio">Aún no hay alojamientos publicados.</li> }
            </ol>
          }
        }
      </section>

      <!-- 3a. Ventas por ciudad (barras horizontales, HTML/CSS) -->
      <section class="tarjeta" aria-labelledby="t-ciudad">
        <h2 id="t-ciudad">Ventas por ciudad</h2>
        @switch (estadoKpi()) {
          @case ('cargando') { <app-cargando texto="Cargando ventas…" /> }
          @case ('error') { <p class="alerta alerta-error" role="alert">No se pudieron cargar las ventas por ciudad.</p> }
          @default {
            @if (ciudades().length) {
              <figure class="grafico">
                <figcaption class="ayuda">Volumen vendido (USD, reservas confirmadas y completadas) por ciudad, de mayor a menor.</figcaption>
                <div class="barras-h" role="img" [attr.aria-label]="altCiudades()">
                  @for (c of ciudades(); track c.ciudad + c.provincia) {
                    <div class="barra-fila" [title]="c.ciudad + ': ' + usd(c.volumen) + ' · ' + plural(c.reservas, 'reserva')">
                      <span class="barra-etq">{{ c.ciudad }}</span>
                      <span class="barra-pista"><span class="barra-valor" [style.width.%]="(c.volumen / maxCiudad()) * 100"></span></span>
                      <span class="barra-num">{{ usdCorto(c.volumen) }}</span>
                    </div>
                  }
                </div>
                <details class="datos-tabla">
                  <summary>Ver datos en tabla</summary>
                  <div class="tabla-scroll">
                    <table class="tabla">
                      <caption class="sr-only">Ventas por ciudad</caption>
                      <thead><tr><th scope="col">Ciudad</th><th scope="col">Provincia</th><th scope="col">Reservas</th><th scope="col">Volumen</th></tr></thead>
                      <tbody>@for (c of ciudades(); track c.ciudad + c.provincia) { <tr><td>{{ c.ciudad }}</td><td>{{ c.provincia }}</td><td>{{ c.reservas }}</td><td>{{ c.volumen | currency: 'USD' }}</td></tr> }</tbody>
                    </table>
                  </div>
                </details>
              </figure>
            } @else { <p class="vacio">Todavía no hay ventas.</p> }
          }
        }
      </section>
    </div>

    <!-- 3b. Ventas por mes (columnas SVG) -->
    <section class="tarjeta mt" aria-labelledby="t-mes">
      <h2 id="t-mes">Ventas por mes</h2>
      @switch (estadoMes()) {
        @case ('cargando') { <app-cargando texto="Cargando reservas…" /> }
        @case ('error') { <p class="alerta alerta-error" role="alert">No se pudieron cargar las ventas por mes: {{ errorMes() }} <button class="btn btn-chico" type="button" (click)="cargarMeses()">Reintentar</button></p> }
        @default {
          <figure class="grafico">
            <figcaption class="ayuda">Volumen vendido (USD) en los últimos 12 meses según la fecha en que se hizo la reserva (confirmadas y completadas).</figcaption>
            @if (totalMeses() > 0) {
              <svg class="grafico-mes" [attr.viewBox]="'0 0 ' + G.ancho + ' ' + G.alto" role="img" [attr.aria-label]="altMeses()" preserveAspectRatio="xMidYMid meet">
                @for (t of ejeY(); track t) {
                  <line class="grid" [attr.x1]="G.izq" [attr.x2]="G.ancho - G.der" [attr.y1]="y(t)" [attr.y2]="y(t)" />
                  <text class="eje" [attr.x]="G.izq - 6" [attr.y]="y(t) + 4" text-anchor="end">{{ usdCorto(t) }}</text>
                }
                @for (m of meses(); track m.clave; let i = $index) {
                  <g class="columna">
                    <title>{{ m.etiquetaLarga }}: {{ usd(m.volumen) }} · {{ plural(m.reservas, 'reserva') }}</title>
                    <rect class="hit" [attr.x]="xCol(i)" [attr.y]="G.arr" [attr.width]="anchoCol()" [attr.height]="base() - G.arr" />
                    <path class="dato" [attr.d]="barraMes(i, m.volumen)" />
                    @if (m.volumen > 0 && (i === iMax() || i === meses().length - 1)) {
                      <text class="valor" [attr.x]="xCol(i) + anchoCol() / 2" [attr.y]="y(m.volumen) - 5" text-anchor="middle">{{ usdCorto(m.volumen) }}</text>
                    }
                    <text class="eje mes" [class.impar]="i % 2 === 1" [attr.x]="xCol(i) + anchoCol() / 2" [attr.y]="G.alto - 14" text-anchor="middle">{{ m.etiqueta }}</text>
                  </g>
                }
                <line class="base" [attr.x1]="G.izq" [attr.x2]="G.ancho - G.der" [attr.y1]="base()" [attr.y2]="base()" />
              </svg>
            } @else { <p class="vacio">No hay ventas en los últimos 12 meses.</p> }
            <details class="datos-tabla">
              <summary>Ver datos en tabla</summary>
              <div class="tabla-scroll">
                <table class="tabla">
                  <caption class="sr-only">Ventas por mes</caption>
                  <thead><tr><th scope="col">Mes</th><th scope="col">Reservas</th><th scope="col">Volumen</th></tr></thead>
                  <tbody>@for (m of meses(); track m.clave) { <tr><td>{{ m.etiquetaLarga }}</td><td>{{ m.reservas }}</td><td>{{ m.volumen | currency: 'USD' }}</td></tr> }</tbody>
                </table>
              </div>
            </details>
          </figure>
        }
      }
    </section>

    <!-- 4. Mapa -->
    <section class="tarjeta mt" aria-labelledby="t-mapa">
      <h2 id="t-mapa">Mapa de alojamientos publicados</h2>
      @switch (estadoAloj()) {
        @case ('cargando') { <app-cargando texto="Cargando mapa…" /> }
        @case ('error') { <p class="alerta alerta-error" role="alert">No se pudo cargar el mapa.</p> }
        @default {
          @if (!publicados().length) { <p class="vacio">No hay alojamientos publicados para mostrar.</p> }
        }
      }
      <div #mapa class="mapa-dashboard" [hidden]="estadoAloj() !== 'listo' || !publicados().length"
           role="region" aria-label="Mapa interactivo: un marcador por alojamiento publicado; abre cada marcador para ver nombre, ciudad y calificación"></div>
      @if (estadoAloj() === 'listo' && publicados().length) {
        <details class="datos-tabla">
          <summary>Ver la lista de alojamientos del mapa</summary>
          <div class="tabla-scroll">
            <table class="tabla">
              <caption class="sr-only">Alojamientos publicados</caption>
              <thead><tr><th scope="col">Alojamiento</th><th scope="col">Ciudad</th><th scope="col">Calificación</th></tr></thead>
              <tbody>@for (a of publicados(); track a.id) { <tr><td>{{ a.name }}</td><td>{{ a.city.name }}, {{ a.city.province }}</td><td>{{ textoCalif(a) }}</td></tr> }</tbody>
            </table>
          </div>
        </details>
      }
    </section>
  `,
  styles: `
    .mt { margin-top: 1rem; }
    .dash-kpis small { display: block; font-size: .75rem; }
    .ranking { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
    .ranking li { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: center; gap: .5rem; padding: .4rem 0; border-bottom: 1px solid var(--c-borde-suave); }
    .ranking li.vacio { display: block; }
    .ranking .pos { font-weight: 800; color: var(--c-primario); text-align: center; }
    .ranking-nombre { min-width: 0; display: flex; flex-direction: column; }
    .ranking-nombre a { overflow-wrap: anywhere; }
    .ranking-nombre small { color: var(--c-suave); }
    .grafico { margin: 0; }
    .barras-h { display: grid; gap: .35rem; margin: .6rem 0; }
    .barra-fila { display: grid; grid-template-columns: minmax(0, 8rem) minmax(0, 1fr) 4.5rem; align-items: center; gap: .5rem; font-size: .9rem; }
    .barra-etq { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .barra-pista { height: 14px; }
    .barra-valor { display: block; height: 100%; min-width: 2px; background: var(--c-primario); border-radius: 0 4px 4px 0; }
    .barra-fila:hover .barra-valor { background: var(--c-primario-osc); }
    .barra-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--c-texto); }
    .grafico-mes { width: 100%; max-width: 960px; height: auto; display: block; margin: .5rem auto; }
    .grafico-mes .grid { stroke: var(--c-borde-suave); stroke-width: 1; }
    .grafico-mes .base { stroke: var(--c-borde); stroke-width: 1; }
    .grafico-mes .eje { fill: var(--c-suave); font-size: 14px; }
    .grafico-mes .valor { fill: var(--c-texto); font-size: 14px; font-weight: 700; }
    .grafico-mes .dato { fill: var(--c-primario); }
    .grafico-mes .hit { fill: transparent; }
    .grafico-mes .columna:hover .dato { fill: var(--c-primario-osc); }
    .grafico-mes .columna:hover .hit { fill: var(--c-primario-suave); opacity: .5; }
    .datos-tabla { margin-top: .5rem; }
    .datos-tabla summary { cursor: pointer; color: var(--c-primario); font-weight: 600; }
    .vacio { color: var(--c-suave); }
    .mapa-dashboard { height: 380px; border-radius: var(--radio); border: 1px solid var(--c-borde-suave); margin: .5rem 0; }
    @media (max-width: 560px) {
      .barra-fila { grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr) 3.8rem; font-size: .85rem; }
      .grafico-mes .eje { font-size: 38px; }
      .grafico-mes .valor { font-size: 38px; }
      .ranking li { grid-template-columns: 2rem minmax(0, 1fr); }
      .ranking li app-calificacion { grid-column: 2; }
      .grafico-mes .mes.impar { display: none; }
      .mapa-dashboard { height: 300px; }
    }
  `,
})
export class DashboardAdminComponent implements OnInit, OnDestroy {
  private readonly admin = inject(AdminService);
  private readonly destruir = inject(DestroyRef);
  private readonly catalogo = inject(CatalogoService);
  private readonly host = inject(AnfitrionService);
  private readonly contenedorMapa = viewChild<ElementRef<HTMLDivElement>>('mapa');
  private mapa?: L.Map;
  readonly G = G;
  readonly plural = plural;

  readonly estadoKpi = signal<Estado>('cargando');
  readonly estadoMes = signal<Estado>('cargando');
  readonly estadoAloj = signal<Estado>('cargando');
  readonly errorKpi = signal('');
  readonly errorMes = signal('');
  readonly errorAloj = signal('');

  private readonly ind = signal<Indicadores | null>(null);
  readonly ciudades = signal<VentaCiudad[]>([]);
  readonly meses = signal<VentaMes[]>([]);
  readonly publicados = signal<DetalleAlojamiento[]>([]);

  readonly kpi = computed(() => {
    const i = this.ind();
    if (!i) return null;
    const vendidas = this.ciudades().reduce((s, c) => s + c.reservas, 0);
    const ventas = Number(i.volumen_reservado);
    const canceladas = Number(i.reservas_canceladas);
    return {
      confirmadas: Number(i.reservas_confirmadas),
      ventas,
      vendidas,
      ticket: vendidas ? ventas / vendidas : null,
      canceladas,
      tasaCancelacion: vendidas + canceladas ? canceladas / (vendidas + canceladas) : null,
      publicados: Number(i.alojamientos_publicados),
      usuarios: Number(i.usuarios_activos),
    };
  });

  readonly maxCiudad = computed(() => Math.max(1, ...this.ciudades().map((c) => c.volumen)));
  readonly altCiudades = computed(() => {
    const c = this.ciudades();
    if (!c.length) return 'Sin ventas';
    return `Barras horizontales de ventas por ciudad. Mayor: ${c[0].ciudad} con ${usd.format(c[0].volumen)}. ` +
      `${plural(c.length, 'ciudad', 'ciudades')} en total; los valores exactos están en la tabla de datos.`;
  });

  readonly ranking = computed(() =>
    [...this.publicados()]
      .sort((a, b) => Number(b.rating.reviews > 0) - Number(a.rating.reviews > 0)
        || (b.rating.score ?? 0) - (a.rating.score ?? 0) || b.rating.reviews - a.rating.reviews)
      .slice(0, 5),
  );

  // ---- gráfico por mes ----
  readonly totalMeses = computed(() => this.meses().reduce((s, m) => s + m.volumen, 0));
  readonly ejeY = computed(() => escalaBonita(Math.max(0, ...this.meses().map((m) => m.volumen))));
  readonly iMax = computed(() => {
    const m = this.meses();
    return m.reduce((im, x, i) => (x.volumen > m[im].volumen ? i : im), 0);
  });
  readonly altMeses = computed(() => {
    const m = this.meses();
    if (!m.length) return 'Sin datos';
    const max = m[this.iMax()];
    const ult = m[m.length - 1];
    return `Columnas de ventas por mes, de ${m[0].etiquetaLarga} a ${ult.etiquetaLarga}. Mes más alto: ${max.etiquetaLarga} con ${usd.format(max.volumen)}. ` +
      `Último mes: ${usd.format(ult.volumen)}. Total del periodo: ${usd.format(this.totalMeses())}.`;
  });
  base = () => G.alto - G.aba;
  anchoCol = () => (G.ancho - G.izq - G.der) / Math.max(1, this.meses().length);
  xCol = (i: number) => G.izq + i * this.anchoCol();
  y = (v: number) => {
    const tope = this.ejeY().at(-1) || 1;
    return this.base() - (v / tope) * (this.base() - G.arr);
  };
  barraMes(i: number, v: number): string {
    const w = this.anchoCol() * 0.62;
    return barra(this.xCol(i) + (this.anchoCol() - w) / 2, this.y(v), w, this.base());
  }

  usd = (v: number) => usd.format(v);
  usdCorto = (v: number) => usdCorto.format(v);

  constructor() {
    // El mapa se dibuja cuando hay datos y el contenedor existe
    effect(() => {
      const lista = this.publicados();
      const cont = this.contenedorMapa();
      if (this.estadoAloj() === 'listo' && lista.length && cont) setTimeout(() => this.pintarMapa(cont.nativeElement, lista));
    });
  }

  ngOnInit(): void {
    this.cargarKpi();
    this.cargarMeses();
    this.cargarAlojamientos();
    // En vivo: los indicadores se vuelven a leer solos (sin spinner) mientras el panel está abierto
    enVivo(this.destruir, () => this.cargarKpi(true), 30000);
  }

  ngOnDestroy(): void {
    this.mapa?.remove();
  }

  cargarKpi(silencioso = false): void {
    if (!silencioso) this.estadoKpi.set('cargando');
    forkJoin([this.admin.indicadores(), this.admin.ventasPorCiudad()]).subscribe({
      next: ([ind, ventas]) => {
        this.ind.set(ind);
        this.ciudades.set(
          ventas
            .map((v) => ({ ciudad: v.ciudad, provincia: v.provincia, reservas: Number(v.reservas), volumen: Number(v.volumen) }))
            .sort((a, b) => b.volumen - a.volumen),
        );
        this.estadoKpi.set('listo');
      },
      error: (e) => {
        if (silencioso) return;
        this.errorKpi.set(leerError(e).mensaje);
        this.estadoKpi.set('error');
      },
    });
  }

  /** Todas las reservas (páginas de 100) → volumen por mes de creación, últimos 12 meses. */
  cargarMeses(): void {
    this.estadoMes.set('cargando');
    const pagina = (offset: number) => this.host.reservas('', 100, offset);
    pagina(0)
      .pipe(
        expand((r) => (r.items.length && r.offset + r.items.length < r.total ? pagina(r.offset + r.items.length) : EMPTY)),
        reduce((todas, r) => todas.concat(r.items), [] as ReservaHost[]),
      )
      .subscribe({
        next: (reservas) => {
          this.meses.set(agruparPorMes(reservas, new Date()));
          this.estadoMes.set('listo');
        },
        error: (e) => {
          this.errorMes.set(leerError(e).mensaje);
          this.estadoMes.set('error');
        },
      });
  }

  cargarAlojamientos(): void {
    this.estadoAloj.set('cargando');
    this.admin
      .alojamientos('PUBLICADO', '', 100, 0)
      .pipe(
        map((l) => l.items.map((a) => Number(a['codigo']))),
        switchMap((codigos) => (codigos.length ? this.catalogo.detalles(codigos) : of([] as DetalleAlojamiento[]))),
      )
      .subscribe({
        next: (lista) => {
          this.publicados.set(lista);
          this.estadoAloj.set('listo');
        },
        error: (e) => {
          this.errorAloj.set(leerError(e).mensaje);
          this.estadoAloj.set('error');
        },
      });
  }

  textoCalif(a: DetalleAlojamiento): string {
    if (!a.rating.reviews || a.rating.score === null) return 'Nuevo (sin reseñas)';
    const e = aEstrellas(a.rating.score);
    return `${e.toLocaleString('es-EC', { minimumFractionDigits: e % 1 ? 1 : 0 })} de 5 estrellas · ${plural(a.rating.reviews, 'reseña')}`;
  }

  private pintarMapa(el: HTMLElement, lista: DetalleAlojamiento[]): void {
    try {
      this.mapa?.remove();
      this.mapa = L.map(el, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      }).addTo(this.mapa);
      const puntos: L.LatLngTuple[] = [];
      for (const a of lista) {
        const lat = Number(a.location?.latitude);
        const lon = Number(a.location?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        puntos.push([lat, lon]);
        // Contenido con textContent (sin HTML del servidor) y sin coordenadas
        const pop = document.createElement('div');
        const nombre = document.createElement('strong');
        nombre.textContent = a.name;
        const ciudad = document.createElement('div');
        ciudad.textContent = `${a.city.name}, ${a.city.province}`;
        const calif = document.createElement('div');
        calif.textContent = this.textoCalif(a);
        pop.append(nombre, ciudad, calif);
        L.marker([lat, lon], {
          icon: L.divIcon({ className: 'pin-mapa', html: '<span></span>', iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -38] }),
          title: a.name,
          alt: a.name,
          keyboard: true,
        }).bindPopup(pop).addTo(this.mapa);
      }
      if (puntos.length === 1) this.mapa.setView(puntos[0], 12);
      else if (puntos.length) this.mapa.fitBounds(L.latLngBounds(puntos), { padding: [30, 30] });
      else this.mapa.setView([-1.5, -78.5], 6);
      setTimeout(() => this.mapa?.invalidateSize(), 0);
    } catch {
      this.errorAloj.set('el mapa no se pudo dibujar en este navegador');
      this.estadoAloj.set('error');
    }
  }
}

/** Agrupa reservas CONFIRMADA/COMPLETADA por mes de creación (12 meses hasta `hoy`, incluidos los vacíos). */
export function agruparPorMes(reservas: Pick<ReservaHost, 'estado' | 'created_at' | 'total'>[], hoy: Date): VentaMes[] {
  const meses: VentaMes[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({
      clave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      etiqueta: MESES[d.getMonth()],
      etiquetaLarga: `${MESES_LARGOS[d.getMonth()]} ${d.getFullYear()}`,
      reservas: 0,
      volumen: 0,
    });
  }
  const porClave = new Map(meses.map((m) => [m.clave, m]));
  for (const r of reservas) {
    if (r.estado !== 'CONFIRMADA' && r.estado !== 'COMPLETADA') continue;
    const d = new Date(r.created_at);
    const m = porClave.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (!m) continue;
    m.reservas += 1;
    m.volumen += Number(r.total) || 0;
  }
  return meses;
}
