import { Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AnfitrionService, Unidad } from '../../core/services/anfitrion.service';
import { CatalogoService } from '../../core/services/catalogo.service';
import { avisoTemporal } from '../../shared/aviso';
import { AlertaErrorComponent, CargandoComponent, EstadoComponent } from '../../shared/ui';
import { traducirMotivoApi } from '../../shared/validadores';
import { crearFormAlojamiento, datosDe, enlazarForm, leerReglas, ubicarErroresApi } from './alojamiento-form';
import { ConCambiosSinGuardar } from './cambios.guard';
import {
  CampoBloqueadoComponent, SecAmenidadesComponent, SecFotosComponent, SecHorariosComponent, SecReservasComponent, SecTextoComponent, SecTipoComponent,
  SecUbicacionComponent,
} from './secciones';
import { CalendarioPanelComponent, UnidadesPanelComponent } from './unidades';

type IdSeccion = 'basica' | 'ubicacion' | 'reglas' | 'habitaciones' | 'calendario' | 'fotos';

/** Campos del formulario de cada sección (las de habitaciones y calendario guardan directo contra la API). */
const CAMPOS: Record<'basica' | 'ubicacion' | 'reglas' | 'fotos', string[]> = {
  basica: ['tipo_id', 'nombre', 'descripcion', 'amenidades'],
  ubicacion: ['ciudad_id', 'direccion', 'latitud', 'longitud'],
  reglas: ['hora_checkin', 'hora_checkout', 'noches_min', 'noches_max', 'tarifa_limpieza', 'telefono_contacto', 'categoria_estrellas',
    'modo_reserva', 'politica_id', 'no_fumar', 'no_mascotas', 'no_fiestas', 'silencio', 'hora_silencio', 'reglas_extra'],
  fotos: ['imagenes'],
};
/** Lo que se envía al PATCH por sección (las casillas de reglas se envían como el texto reglas_casa). */
const ENVIO: Record<keyof typeof CAMPOS, string[]> = {
  basica: CAMPOS.basica,
  ubicacion: CAMPOS.ubicacion,
  reglas: [...CAMPOS.reglas.filter((c) => !['no_fumar', 'no_mascotas', 'no_fiestas', 'silencio', 'hora_silencio', 'reglas_extra'].includes(c)), 'reglas_casa'],
  fotos: CAMPOS.fotos,
};
type SeccionForm = keyof typeof CAMPOS;
const NOMBRE_SECCION: Record<SeccionForm, string> = { basica: 'Información básica', ubicacion: 'Ubicación', reglas: 'Reglas y reservas', fotos: 'Fotos' };

/** Editar un alojamiento existente: una página con secciones y un único botón «Guardar cambios». */
@Component({
  selector: 'app-edicion-alojamiento',
  imports: [
    ReactiveFormsModule, RouterLink, AlertaErrorComponent, CargandoComponent, EstadoComponent, CampoBloqueadoComponent,
    SecTipoComponent, SecTextoComponent, SecAmenidadesComponent, SecUbicacionComponent, SecHorariosComponent, SecReservasComponent, SecFotosComponent,
    UnidadesPanelComponent, CalendarioPanelComponent,
  ],
  template: `
    <a routerLink="/admin" [queryParams]="{ tab: 'alojamientos' }" class="volver"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Volver a Alojamientos</span></a>
    <div class="edicion-cabecera d-flex align-items-center flex-wrap mb-3">
      <h1>{{ nombre() || 'Editar alojamiento' }}</h1>
      @if (estado()) { <app-estado [estado]="estado()" /> }
    </div>
    @if (bienvenida()) { <p class="alerta alerta-ok" role="status">{{ bienvenida() }}</p> }
    @if (avisoUnidades()) { <p class="alerta alerta-aviso" role="alert">{{ avisoUnidades() }}</p> }
    <app-alerta-error [error]="errorCarga()" />
    @if (cargando()) { <app-cargando texto="Cargando el alojamiento…" /> }

    @if (cargado()) {
      <div class="edicion">
        <nav class="edicion-menu" aria-label="Secciones">
          <ul>
            @for (s of secciones; track s.id) {
              <li>
                <a [href]="'#sec-' + s.id" (click)="irA($event, s.id)" [attr.aria-current]="activa() === s.id ? 'true' : null">
                  <span aria-hidden="true">{{ s.icono }}</span> {{ s.titulo }}
                  @if (s.id !== 'habitaciones' && s.id !== 'calendario' && pendiente(s.id)) { <span class="punto" title="Cambios sin guardar"><span class="sr-only">(cambios sin guardar)</span></span> }
                </a>
              </li>
            }
          </ul>
        </nav>

        <div class="edicion-secciones" [formGroup]="form">
          <!-- Información básica -->
          <section class="tarjeta seccion" id="sec-basica" aria-labelledby="t-basica">
            <h2 id="t-basica">Información básica</h2>
            <p class="seccion-intro">Cómo se presenta tu alojamiento: tipo, nombre, descripción y comodidades.</p>
            <div class="bloqueados">
              <app-campo-bloqueado etiqueta="Estado del anuncio" [valor]="textoEstado()" [motivo]="motivoEstado()" />
            </div>
            <app-sec-tipo [form]="form" />
            <app-sec-texto [form]="form" />
            <h3>Comodidades</h3>
            <app-sec-amenidades [form]="form" />
            @if (errores()['basica']; as e) { <p class="aviso-guardado error" role="alert">✗ {{ e }}</p> }
          </section>

          <!-- Ubicación -->
          <section class="tarjeta seccion" id="sec-ubicacion" aria-labelledby="t-ubicacion">
            <h2 id="t-ubicacion">Ubicación</h2>
            <p class="seccion-intro">Dónde está. Escribe la dirección o toca el mapa: la dirección se completa sola.</p>
            <app-sec-ubicacion [form]="form" />
            @if (errores()['ubicacion']; as e) { <p class="aviso-guardado error" role="alert">✗ {{ e }}</p> }
          </section>

          <!-- Reglas y reservas -->
          <section class="tarjeta seccion" id="sec-reglas" aria-labelledby="t-reglas">
            <h2 id="t-reglas">Reglas y reservas</h2>
            <p class="seccion-intro">Horarios, estancia mínima, política de cancelación y reglas de la casa.</p>
            <app-sec-horarios [form]="form" />
            <app-sec-reservas [form]="form" />
            @if (errores()['reglas']; as e) { <p class="aviso-guardado error" role="alert">✗ {{ e }}</p> }
          </section>

          <!-- Habitaciones y precios -->
          <section class="tarjeta seccion" id="sec-habitaciones" aria-labelledby="t-habitaciones">
            <h2 id="t-habitaciones">{{ tituloHabitaciones() }}</h2>
            <app-unidades-panel [codigo]="codigo()" [nombreAlojamiento]="nombre()" [unidades]="unidades()"
                                (cambio)="unidades.set($event)" (verCalendario)="abrirCalendario($event)" />
          </section>

          <!-- Calendario -->
          <section class="tarjeta seccion" id="sec-calendario" aria-labelledby="t-calendario">
            <h2 id="t-calendario">Precios y disponibilidad por fecha (opcional)</h2>
            <app-calendario-panel #calendario [unidades]="unidades()" />
          </section>

          <!-- Fotos -->
          <section class="tarjeta seccion" id="sec-fotos" aria-labelledby="t-fotos">
            <h2 id="t-fotos">Fotos</h2>
            <p class="seccion-intro">Las fotos son lo primero que ve el huésped: elige las mejores.</p>
            <app-sec-fotos [form]="form" />
            @if (errores()['fotos']; as e) { <p class="aviso-guardado error" role="alert">✗ {{ e }}</p> }
          </section>
        </div>
      </div>

      <div class="barra-guardado" role="region" aria-label="Guardar los cambios del alojamiento">
        <div class="barra-guardado-texto" role="status">
          <strong [class.pendiente]="pendientes().length > 0">{{ textoGuardado() }}</strong>
          <small>Habitaciones, precios y calendario se guardan en su propia sección.</small>
          @if (errorGuardado(); as e) { <span class="aviso-guardado error" role="alert">✗ {{ e }}</span> }
        </div>
        <button type="button" class="btn" (click)="descartarTodo()" [disabled]="guardandoTodo() || !pendientes().length">Descartar cambios</button>
        <button type="button" class="btn btn-primario" (click)="guardarTodo()" [disabled]="guardandoTodo() || !pendientes().length">{{ guardandoTodo() ? 'Guardando…' : 'Guardar cambios' }}</button>
      </div>
    }
  `,
})
export class EdicionAlojamientoComponent implements OnInit, ConCambiosSinGuardar {
  // El alias es el nombre del parámetro de ruta (:codigo); `codigo` ya es la señal numérica del componente
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly codigoRuta = input<string>('', { alias: 'codigo' });
  private readonly api = inject(AnfitrionService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(FormBuilder);
  private readonly c = toSignal(inject(CatalogoService).constantes());
  private readonly calendario = viewChild<CalendarioPanelComponent>('calendario');

  readonly secciones: { id: IdSeccion; titulo: string; icono: string }[] = [
    { id: 'basica', titulo: 'Información básica', icono: '📝' },
    { id: 'ubicacion', titulo: 'Ubicación', icono: '📍' },
    { id: 'reglas', titulo: 'Reglas y reservas', icono: '📋' },
    { id: 'habitaciones', titulo: 'Habitaciones y precios', icono: '🛏️' },
    { id: 'calendario', titulo: 'Precios por fecha (opcional)', icono: '📅' },
    { id: 'fotos', titulo: 'Fotos', icono: '📷' },
  ];
  readonly codigo = signal(0);
  readonly estado = signal('');
  readonly nombre = signal('');
  readonly unidades = signal<Unidad[]>([]);
  readonly cargando = signal(true);
  readonly cargado = signal(false);
  readonly errorCarga = signal<ErrorVista | null>(null);
  readonly bienvenida = signal('');
  readonly avisoUnidades = signal('');
  readonly activa = signal<IdSeccion>('basica');
  readonly errores = signal<Partial<Record<SeccionForm, string>>>({});
  readonly guardandoTodo = signal(false);
  readonly errorGuardado = signal('');
  private readonly okGuardado = avisoTemporal(5000);

  readonly form = crearFormAlojamiento(this.fb);
  private readonly valores = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** Copia de lo guardado por sección, para saber si hay cambios. */
  private readonly base = signal<Partial<Record<SeccionForm, string>>>({});

  readonly tituloHabitaciones = computed(() => {
    const u = this.unidades();
    return u.length === 1 && u[0].cantidad === 1 ? 'Alojamiento completo y precio' : 'Habitaciones y precios';
  });
  readonly textoEstado = computed(() => ({ PUBLICADO: 'Publicado', BORRADOR: 'Borrador', SUSPENDIDO: 'Suspendido' })[this.estado()] ?? this.estado());
  readonly motivoEstado = computed(() =>
    this.estado() === 'SUSPENDIDO'
      ? 'Está suspendido: reactívalo desde Administración → Alojamientos.'
      : 'No se cambia aquí: usa Publicar o Despublicar en Administración → Alojamientos.',
  );

  private observador?: IntersectionObserver;

  constructor() {
    enlazarForm(this.form);
    // Marca en el menú la sección que se está viendo al hacer scroll
    effect(() => {
      if (!this.cargado()) return;
      setTimeout(() => {
        this.observador?.disconnect();
        this.observador = new IntersectionObserver(
          (entradas) => {
            const visible = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            if (visible) this.activa.set(visible.target.id.replace('sec-', '') as IdSeccion);
          },
          { rootMargin: '-120px 0px -55% 0px' },
        );
        this.raiz.nativeElement.querySelectorAll('.seccion').forEach((s) => this.observador?.observe(s));
      });
    });
    inject(DestroyRef).onDestroy(() => this.observador?.disconnect());
  }

  ngOnInit(): void {
    const cod = Number(this.codigoRuta());
    this.codigo.set(cod);
    const q = this.ruta.snapshot.queryParamMap;
    if (q.get('creado')) this.bienvenida.set('¡Borrador creado! Revisa cada sección y, cuando esté listo, publícalo desde Administración → Alojamientos.');
    if (q.get('unidades') === 'fallo') {
      this.avisoUnidades.set('El borrador se creó, pero no pudimos guardar las habitaciones y precios. Agrégalas en la sección "Habitaciones y precios" para poder publicarlo.');
    }
    this.cargar(cod);
  }

  // ---------- Cambios sin guardar ----------
  private foto(s: SeccionForm): string {
    const v = this.form.getRawValue() as Record<string, unknown>;
    return JSON.stringify(CAMPOS[s].map((c) => v[c]));
  }
  pendiente(s: IdSeccion): boolean {
    if (!(s in CAMPOS)) return false;
    this.valores();
    return this.foto(s as SeccionForm) !== this.base()[s as SeccionForm];
  }
  seccionInvalida(s: SeccionForm): boolean {
    this.valores();
    return CAMPOS[s].some((c) => this.form.get(c)?.invalid);
  }
  /** Vuelve la sección a lo último guardado (sin llamar al API). */
  descartar(s: SeccionForm): void {
    const guardado = this.base()[s];
    if (!guardado) return;
    const valores = JSON.parse(guardado) as unknown[];
    CAMPOS[s].forEach((c, i) => {
      const control = this.form.get(c);
      control?.setValue(valores[i]);
      control?.markAsPristine();
      control?.markAsUntouched();
    });
    this.errores.update((e) => ({ ...e, [s]: undefined }));
  }
  hayCambiosSinGuardar(): boolean {
    return (Object.keys(CAMPOS) as SeccionForm[]).some((s) => this.pendiente(s)) || !!this.calendario()?.hayCambios();
  }
  @HostListener('window:beforeunload', ['$event'])
  avisarAlCerrar(ev: BeforeUnloadEvent): void {
    if (this.hayCambiosSinGuardar()) ev.preventDefault();
  }

  // ---------- Navegación entre secciones ----------
  irA(ev: Event, id: IdSeccion): void {
    ev.preventDefault();
    this.activa.set(id);
    const sec = this.raiz.nativeElement.querySelector<HTMLElement>(`#sec-${id}`);
    sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sec?.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
    setTimeout(() => sec?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }), 350);
  }
  abrirCalendario(u: Unidad): void {
    this.calendario()?.abrir(u);
    this.irA(new Event('click'), 'calendario');
  }

  // ---------- Carga y guardado ----------
  private cargar(cod: number): void {
    this.api.obtener(cod).subscribe({
      next: (a) => {
        this.estado.set(a.estado);
        this.nombre.set(a.nombre);
        this.form.patchValue({
          tipo_id: a.tipo_id, ciudad_id: a.ciudad_id, politica_id: a.politica_id, direccion: a.direccion,
          latitud: a.latitud, longitud: a.longitud, nombre: a.nombre, descripcion: a.descripcion,
          hora_checkin: (a.hora_checkin ?? '14:00').slice(0, 5), hora_checkout: (a.hora_checkout ?? '12:00').slice(0, 5),
          noches_min: a.noches_min ?? 1, noches_max: a.noches_max ?? 30, tarifa_limpieza: a.tarifa_limpieza ?? 0,
          modo_reserva: 'INSTANTANEA', telefono_contacto: a.telefono_contacto ?? '',
          categoria_estrellas: a.categoria_estrellas ?? null,
          amenidades: a.amenidades ?? [], imagenes: (a.imagenes ?? []).map((i) => i.url).join('\n'),
          ...leerReglas(a.reglas_casa ?? ''),
        });
        this.unidades.set(a.unidades);
        this.fijarBase();
        this.form.markAsPristine();
        this.cargando.set(false);
        this.cargado.set(true);
      },
      error: (e) => {
        this.errorCarga.set(leerError(e));
        this.cargando.set(false);
      },
    });
  }

  private fijarBase(...soloEstas: SeccionForm[]): void {
    const todas = soloEstas.length ? soloEstas : (Object.keys(CAMPOS) as SeccionForm[]);
    this.base.update((b) => ({ ...b, ...Object.fromEntries(todas.map((s) => [s, this.foto(s)])) }));
  }

  /** Secciones del formulario con cambios sin guardar. */
  readonly pendientes = computed(() => {
    this.valores();
    this.base();
    return (Object.keys(CAMPOS) as SeccionForm[]).filter((s) => this.pendiente(s));
  });
  readonly textoGuardado = computed(() => {
    const p = this.pendientes();
    if (p.length) return `Cambios sin guardar en: ${p.map((s) => NOMBRE_SECCION[s]).join(', ')}`;
    return this.okGuardado.texto() ? '✓ Todos los cambios están guardados' : 'Sin cambios pendientes';
  });

  descartarTodo(): void {
    for (const s of this.pendientes()) this.descartar(s);
    this.errorGuardado.set('');
  }

  /** Un solo guardado: valida todas las secciones con cambios y las envía en una única petición. */
  guardarTodo(): void {
    const pend = this.pendientes();
    if (!pend.length || this.guardandoTodo()) return;
    this.errorGuardado.set('');
    this.errores.set({});
    for (const s of pend) for (const c of CAMPOS[s]) this.form.get(c)?.markAllAsTouched();
    const malas = pend.filter((s) => CAMPOS[s].some((c) => this.form.get(c)?.invalid));
    if (malas.length) {
      this.errores.set(Object.fromEntries(malas.map((s) => [s, 'Revisa los campos marcados en rojo.'])));
      this.errorGuardado.set(`Revisa los campos marcados en rojo en: ${malas.map((s) => NOMBRE_SECCION[s]).join(', ')}.`);
      setTimeout(() => {
        const el = this.raiz.nativeElement.querySelector<HTMLElement>(`#sec-${malas[0]} [aria-invalid="true"]`) ?? this.raiz.nativeElement.querySelector<HTMLElement>(`#sec-${malas[0]} .msg-error`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus?.();
      });
      return;
    }
    this.guardandoTodo.set(true);
    const campos = [...new Set(pend.flatMap((s) => ENVIO[s]))];
    this.api.actualizar(this.codigo(), datosDe(this.form, campos)).subscribe({
      next: () => {
        this.guardandoTodo.set(false);
        this.fijarBase(...pend);
        if (pend.includes('basica')) this.nombre.set((this.form.controls.nombre.value ?? '').trim());
        this.okGuardado.mostrar('Guardado');
      },
      error: (e) => {
        this.guardandoTodo.set(false);
        const err = leerError(e);
        const ubicados = ubicarErroresApi(this.form, err.campos, traducirMotivoApi);
        this.errorGuardado.set(ubicados.length ? 'Revisa los campos marcados en rojo.' : err.mensaje);
      },
    });
  }
}
