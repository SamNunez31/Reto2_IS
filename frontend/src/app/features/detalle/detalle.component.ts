import { CurrencyPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { DetalleAlojamiento, Huespedes, Producto, Puntaje, Resena } from '../../core/models/api.models';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AuthService } from '../../core/services/auth.service';
import { CatalogoService } from '../../core/services/catalogo.service';
import { ReservasService } from '../../core/services/reservas.service';
import { LoginModalService } from '../../core/services/login-modal.service';
import { CalificacionComponent, ContadorComponent } from '../../shared/calificacion';
import { fechaMasDias, hoyEcuador, motivoFechas } from '../../shared/fechas';
import { fechaLarga, noches, plural, textoHuespedes, tituloPolitica } from '../../shared/textos';
import { AlertaErrorComponent, CargandoComponent, EstrellasComponent, VacioComponent } from '../../shared/ui';
import { lineasTramos } from '../anfitrion/politicas.service';

/** Una opción reservable (tipo de habitación) con su precio o el motivo por el que no se puede reservar. */
interface Opcion {
  nombre: string;
  capacidad: number;
  cantidad: number | null;
  producto: Producto | null;
  motivo: string;
  /** Acción sugerida para resolver el motivo (p. ej. subir las habitaciones). */
  accion: { texto: string; habitaciones: number } | null;
}

@Component({
  selector: 'app-detalle',
  imports: [FormsModule, RouterLink, CurrencyPipe, AlertaErrorComponent, CargandoComponent, EstrellasComponent, VacioComponent, CalificacionComponent, ContadorComponent],
  template: `
    <app-alerta-error [error]="error()" />
    @if (!aloj() && !error()) { <app-cargando /> }
    @if (aloj(); as a) {
      <a routerLink="/" class="volver"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Volver</span></a>
      <header class="cabecera-detalle">
        <h1>{{ a.name }} <app-estrellas [n]="a.stars" /></h1>
        <p class="meta cabecera-calif d-flex align-items-center flex-wrap">
          <app-calificacion [nota]="a.rating.score" [resenas]="a.rating.reviews" />
          <span>· {{ a.type }} · {{ a.city.name }}, {{ a.city.province }}</span>
        </p>
      </header>

      <section class="galeria" aria-label="Galería de fotos">
        @if (fotoActiva() || a.cover_photo; as foto) {
          <img class="principal" [src]="foto" [alt]="'Foto de ' + a.name" />
        } @else {
          <div class="principal sin-foto"><span class="icono" aria-hidden="true">📷</span>Sin foto</div>
        }
        <div class="miniaturas">
          @for (f of a.photos ?? []; track f.url) {
            <button type="button" (click)="fotoActiva.set(f.url)" [attr.aria-label]="'Ver foto ' + (f.order + 1)" [class.activa]="fotoActiva() === f.url">
              <img [src]="f.url" alt="" loading="lazy" />
            </button>
          }
        </div>
      </section>

      <div class="dos-columnas">
        <div>
          <section class="tarjeta">
            <h2>Descripción</h2>
            <p class="meta">📍 {{ a.location.address }}, {{ a.city.name }}</p>
            <p class="texto">{{ a.description }}</p>
            @if (a.policies?.house_rules) { <h3>Reglas de la casa</h3><p class="texto">{{ a.policies?.house_rules }}</p> }
          </section>

          <section class="tarjeta">
            <h2>Lo que ofrece</h2>
            <ul class="chips d-flex flex-wrap p-0">
              @for (f of a.facilities ?? []; track f.id) { <li>{{ f.name }}</li> } @empty { <li>Sin comodidades registradas</li> }
            </ul>
          </section>

          @if (a.policies; as p) {
            <section class="tarjeta">
              <h2>Cancelación: {{ titulo(p.cancellation.name) }}</h2>
              <ol class="linea-tiempo">
                @for (l of lineas(p.cancellation.rules); track l.cuando) {
                  <li [class.verde]="l.pct === 0" [class.ambar]="l.pct > 0 && l.pct < 100" [class.rojo]="l.pct === 100"><strong>{{ l.cuando }}</strong><span>{{ l.efecto }}</span></li>
                }
              </ol>
              <p class="meta">Check-in desde las {{ p.checkin_from }} · Check-out hasta las {{ p.checkout_until }} ·
                Estancia de {{ p.min_nights }} a {{ plural(p.max_nights, 'noche') }} · Reserva inmediata: se confirma al aprobarse el pago</p>
            </section>
          }

          <section class="tarjeta">
            <h2 class="titulo-resenas">Reseñas
              @if (puntaje(); as s) { <app-calificacion [nota]="s.score" [resenas]="s.number_of_reviews" /> }
            </h2>
            @for (r of resenas(); track r.id) {
              <article class="resena">
                <p class="resena-cabecera d-flex align-items-center flex-wrap gap-2"><strong>{{ r.author }}</strong> <app-calificacion [nota]="r.score" [sinConteo]="true" [chica]="true" />
                  <small>{{ fecha(r.created_at) }}</small></p>
                @if (r.comment) { <p class="texto">{{ r.comment }}</p> }
                @if (r.host_reply) { <p class="respuesta">Respuesta del alojamiento: {{ r.host_reply }}</p> }
              </article>
            } @empty { <app-vacio texto="Aún no hay reseñas: sé de los primeros en hospedarte aquí." /> }
            @if (masResenas()) { <button class="btn" type="button" (click)="cargarResenas()">Ver más reseñas</button> }
          </section>
        </div>

        <!-- Tarjeta de disponibilidad -->
        <aside class="tarjeta reserva-lateral tarjeta-reserva" aria-label="Disponibilidad y precios">
          @if (a.price_from) { <p class="desde-precio"><strong>{{ a.price_from | currency: 'USD' }}</strong> <span>/ noche</span></p> }
          <div class="fechas-reserva row g-2">
            <label class="col-6">Entrada <input type="date" [ngModel]="checkin()" (ngModelChange)="cambiarEntrada($event)" [min]="hoy"
                   [attr.aria-invalid]="!!fechas().entrada" [attr.aria-describedby]="fechas().entrada ? 'err-det-checkin' : null" />
              @if (fechas().entrada) { <small class="msg-fecha" id="err-det-checkin" role="alert">{{ fechas().entrada }}</small> }</label>
            <label class="col-6">Salida <input type="date" [ngModel]="checkout()" (ngModelChange)="checkout.set($event)" [min]="checkin()"
                   [attr.aria-invalid]="!!fechas().salida" [attr.aria-describedby]="fechas().salida ? 'err-det-checkout' : null" />
              @if (fechas().salida) { <small class="msg-fecha" id="err-det-checkout" role="alert">{{ fechas().salida }}</small> }</label>
          </div>
          <details class="huespedes-plegable" [open]="huespedesAbierto()" (toggle)="huespedesAbierto.set($any($event.target).open)">
            <summary><span class="contador-etiqueta">Huéspedes</span> {{ resumen() }}</summary>
            <app-contador id="c-adultos" etiqueta="Adultos" singular="un adulto" detalle="13 años o más" [min]="1" [max]="30" [(valor)]="adultos" />
            <app-contador id="c-ninos" etiqueta="Niños" singular="un niño" detalle="De 0 a 12 años" [min]="0" [max]="10" [(valor)]="ninos" />
            <app-contador id="c-hab" etiqueta="Habitaciones" singular="una habitación" [min]="1" [max]="20" [(valor)]="habitaciones" />
          </details>
          <p class="meta resumen-estadia">{{ resumenEstadia() }}</p>

          <app-alerta-error [error]="errorDisp()" />
          <div aria-live="polite">
            @if (cotizando()) { <app-cargando texto="Actualizando precios…" /> }
          </div>

          @if (!cotizando() && !errorFechas() && productos() !== null) {
            @if (estanciaInvalida(); as m) {
              <p class="alerta alerta-aviso">{{ m }}</p>
            } @else {
              @for (o of opciones(); track o.nombre) {
                <article class="producto" [class.no-disponible]="!o.producto">
                  <h3>{{ o.nombre }}</h3>
                  <p class="meta">Capacidad: {{ plural(o.capacidad, 'huésped', 'huéspedes') }} por habitación
                    @if (o.producto && o.producto.available_rooms <= 3) { · <span class="pocas">Pocas disponibles</span> }</p>
                  @if (o.producto; as p) {
                    <dl class="desglose">
                      <dt>{{ porNoche(p) | currency: 'USD' }} × {{ plural(p.nights, 'noche') }}{{ habitaciones() > 1 ? ' × ' + plural(habitaciones(), 'habitación', 'habitaciones') : '' }}</dt>
                      <dd>{{ p.price.base | currency: 'USD' }}</dd>
                      @if (p.price.cleaning_fee) { <dt>Limpieza</dt><dd>{{ p.price.cleaning_fee | currency: 'USD' }}</dd> }
                      @if (p.price.service_fee) { <dt>Servicio (10 %)</dt><dd>{{ p.price.service_fee | currency: 'USD' }}</dd> }
                      <dt>IVA</dt><dd>{{ p.price.taxes | currency: 'USD' }}</dd>
                      <dt class="total">Total</dt><dd class="total">{{ p.price.total | currency: 'USD' }}</dd>
                    </dl>
                    @if (esAdmin()) {
                      <p class="ayuda">El administrador no puede reservar.</p>
                    } @else {
                      <button class="btn btn-primario ancho-total w-100" type="button" (click)="reservar(p)">Reservar</button>
                    }
                  } @else {
                    <p class="aviso-capacidad" [id]="'motivo-' + $index">{{ o.motivo }}</p>
                    @if (o.accion; as ac) { <button class="btn btn-chico" type="button" (click)="habitaciones.set(ac.habitaciones)">{{ ac.texto }}</button> }
                    <button class="btn btn-primario ancho-total w-100" type="button" disabled [attr.aria-describedby]="'motivo-' + $index">Reservar</button>
                  }
                </article>
              } @empty {
                <app-vacio texto="No hay habitaciones disponibles para esas fechas." />
              }
              <p class="ayuda centro text-center d-block">Aún no se te cobrará nada.</p>
            }
          }
        </aside>
      </div>
    }
  `,
})
export class DetalleComponent implements OnInit {
  /** Código entero del alojamiento (parámetro de ruta :id). */
  readonly id = input.required<string>();
  private readonly catalogo = inject(CatalogoService);
  private readonly reservas = inject(ReservasService);
  private readonly auth = inject(AuthService);
  private readonly loginModal = inject(LoginModalService);
  private readonly router = inject(Router);
  private readonly ruta = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  /** Hoy en Ecuador (misma referencia que el backend). */
  readonly hoy = hoyEcuador();
  readonly plural = plural;
  readonly titulo = tituloPolitica;
  readonly lineas = lineasTramos;
  readonly fecha = fechaLarga;

  readonly aloj = signal<DetalleAlojamiento | null>(null);
  readonly error = signal<ErrorVista | null>(null);
  readonly fotoActiva = signal<string | null>(null);
  readonly productos = signal<Producto[] | null>(null);
  readonly cotizando = signal(false);
  readonly errorDisp = signal<ErrorVista | null>(null);
  readonly resenas = signal<Resena[]>([]);
  readonly puntaje = signal<Puntaje | null>(null);
  readonly masResenas = signal<string | null>(null);
  readonly esAdmin = this.auth.esAdmin;

  // Criterios de la tarjeta de disponibilidad
  readonly checkin = signal(fechaMasDias(14));
  readonly checkout = signal(fechaMasDias(16));
  readonly adultos = signal(2);
  readonly ninos = signal(0);
  readonly habitaciones = signal(1);
  readonly huespedesAbierto = signal(false);
  readonly totalHuespedes = computed(() => this.adultos() + this.ninos());
  readonly resumen = computed(() => textoHuespedes(this.totalHuespedes(), this.habitaciones()));
  readonly resumenEstadia = computed(() => {
    const n = noches(this.checkin(), this.checkout());
    return n > 0 ? `${fechaLarga(this.checkin())} → ${fechaLarga(this.checkout())} · ${plural(n, 'noche')}` : '';
  });
  /** Error de cada campo de fecha (se muestra bajo el campo). */
  readonly fechas = computed(() => motivoFechas(this.checkin(), this.checkout(), this.hoy));
  readonly errorFechas = computed(() => this.fechas().entrada || this.fechas().salida);
  readonly estanciaInvalida = computed(() => {
    const p = this.aloj()?.policies;
    const n = noches(this.checkin(), this.checkout());
    if (!p || n < 1) return '';
    if (n < p.min_nights || n > p.max_nights) return `Este alojamiento acepta estancias de ${p.min_nights} a ${plural(p.max_nights, 'noche')}; elegiste ${plural(n, 'noche')}.`;
    return '';
  });

  /** Tipos de habitación del alojamiento cruzados con lo que /availability devolvió para estos criterios. */
  readonly opciones = computed<Opcion[]>(() => {
    const prods = this.productos() ?? [];
    const tipos = this.aloj()?.rooms ?? [];
    const huespedes = this.totalHuespedes();
    const hab = this.habitaciones();
    const base = tipos.length ? tipos.map((t) => ({ nombre: t.name, capacidad: t.max_occupancy, cantidad: t.quantity as number | null }))
      : prods.map((p) => ({ nombre: p.name, capacidad: p.max_occupancy, cantidad: null }));
    return base.map((t) => {
      const producto = prods.find((p) => p.name === t.nombre) ?? null;
      if (producto) return { ...t, producto, motivo: '', accion: null };
      const necesarias = Math.ceil(huespedes / t.capacidad);
      if (t.capacidad * hab < huespedes) {
        const alcanza = t.cantidad === null || necesarias <= t.cantidad;
        return {
          ...t, producto: null, accion: alcanza ? { texto: `Usar ${plural(necesarias, 'habitación', 'habitaciones')}`, habitaciones: necesarias } : null,
          motivo: alcanza
            ? `Con ${plural(huespedes, 'huésped', 'huéspedes')} necesitas al menos ${plural(necesarias, 'habitación', 'habitaciones')} de este tipo.`
            : `Este tipo de habitación no alcanza para ${plural(huespedes, 'huésped', 'huéspedes')}.`,
        };
      }
      if (t.cantidad !== null && hab > t.cantidad) {
        return { ...t, producto: null, motivo: `Solo hay ${plural(t.cantidad, 'habitación', 'habitaciones')} de este tipo.`, accion: { texto: `Usar ${plural(t.cantidad, 'habitación', 'habitaciones')}`, habitaciones: t.cantidad } };
      }
      return { ...t, producto: null, motivo: 'No hay disponibilidad en esas fechas.', accion: null };
    });
  });

  private get codigo(): number {
    return Number(this.id());
  }

  constructor() {
    // Recalcula el precio solo, con una pequeña espera tras cada cambio (cancela la consulta anterior)
    const criterios = computed(() => ({ ci: this.checkin(), co: this.checkout(), a: this.adultos(), n: this.ninos(), h: this.habitaciones(), listo: !!this.aloj() }));
    toObservable(criterios)
      .pipe(
        debounceTime(600),
        switchMap((c) => {
          if (!c.listo || this.errorFechas()) return of(null);
          this.cotizando.set(true);
          this.errorDisp.set(null);
          return this.catalogo.disponibilidad(this.codigo, c.ci, c.co, this.huespedes()).pipe(
            tap(() => this.cotizando.set(false)),
            catchError((e) => {
              this.errorDisp.set(leerError(e));
              this.cotizando.set(false);
              return of([] as Producto[]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((p) => {
        if (p !== null) this.productos.set(p);
      });
  }

  ngOnInit(): void {
    const c = this.catalogo.criterios();
    if (c) {
      this.checkin.set(c.checkin);
      this.checkout.set(c.checkout);
      this.adultos.set(c.guests.number_of_adults);
      this.ninos.set(c.guests.children?.length ?? 0);
      this.habitaciones.set(c.guests.number_of_rooms);
    }
    this.catalogo.detalles([this.codigo], ['description', 'facilities', 'payment', 'photos', 'policies', 'rooms']).subscribe({
      next: (d) => {
        if (!d.length) this.router.navigate(['/no-encontrado']);
        else this.aloj.set(d[0]);
      },
      error: (e) => this.error.set(leerError(e)),
    });
    this.catalogo.puntajes(this.codigo).subscribe((p) => this.puntaje.set(p));
    this.cargarResenas();
  }

  cambiarEntrada(v: string): void {
    this.checkin.set(v);
    // Si la salida queda antes de la entrada, se mueve a la noche siguiente
    if (v && noches(v, this.checkout()) < 1) this.checkout.set(fechaMasDias(1, new Date(v + 'T00:00:00')));
  }

  cargarResenas(): void {
    this.catalogo.resenas(this.codigo, this.masResenas() ?? undefined).subscribe((r) => {
      this.resenas.update((l) => [...l, ...r.data]);
      this.masResenas.set(r.next_page);
    });
  }

  private huespedes(): Huespedes {
    return {
      number_of_adults: this.adultos(),
      number_of_rooms: this.habitaciones(),
      ...(this.ninos() > 0 ? { children: Array(this.ninos()).fill(8) } : {}),
    };
  }

  /** Precio por noche y por habitación (el "base" del producto es el total de hospedaje). */
  porNoche(p: Producto): number {
    return p.price.base / Math.max(1, p.nights) / Math.max(1, this.habitaciones());
  }

  reservar(p: Producto): void {
    this.reservas.seleccion.set({
      codigo: this.codigo,
      nombreAlojamiento: this.aloj()?.name ?? '',
      producto: p,
      checkin: this.checkin(),
      checkout: this.checkout(),
      guests: this.huespedes(),
      horaCheckin: this.aloj()?.policies?.checkin_from,
    });
    // ?demo=1 se conserva para mostrar la ayuda de tarjetas de prueba en el pago
    const demo = this.ruta.snapshot.queryParamMap.get('demo') === '1';
    const destino = demo ? '/reservar?demo=1' : '/reservar';
    // Sin sesión: se pide aquí mismo, en la ventana de inicio de sesión, y al entrar se continúa a la reserva
    if (!this.auth.autenticado()) {
      this.loginModal.abrir(destino);
      return;
    }
    this.router.navigateByUrl(destino);
  }
}
