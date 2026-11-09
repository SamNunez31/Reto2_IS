import { CurrencyPipe } from '@angular/common';
import { Component, computed, ElementRef, HostListener, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { concatMap, from, toArray } from 'rxjs';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AnfitrionService, DatosAlojamiento } from '../../core/services/anfitrion.service';
import { CatalogoService } from '../../core/services/catalogo.service';
import { AlertaErrorComponent } from '../../shared/ui';
import { traducirMotivoApi } from '../../shared/validadores';
import {
  crearFormAlojamiento, datosDe, enlazarForm, esUrlHttps, FormUnidad, grupoUnidad, L, Modalidad, NOMBRE_POLITICA, reglasTexto,
  TIPOS_COMPLETOS, ubicarErroresApi, urlsDe,
} from './alojamiento-form';
import { ConCambiosSinGuardar } from './cambios.guard';
import { SecAmenidadesComponent, SecFotosComponent, SecHorariosComponent, SecReservasComponent, SecTextoComponent, SecTipoComponent, SecUbicacionComponent } from './secciones';
import { UnidadesNuevasComponent } from './unidades';

interface Paso { titulo: string; subtitulo: string; campos: string[] }
const PASOS: Paso[] = [
  { titulo: 'Tipo y ubicación', subtitulo: '¿Qué ofreces y dónde está?', campos: ['tipo_id', 'ciudad_id', 'direccion', 'latitud', 'longitud'] },
  { titulo: 'Lo básico', subtitulo: 'Horarios, estadías y datos de contacto.', campos: ['hora_checkin', 'hora_checkout', 'noches_min', 'noches_max', 'tarifa_limpieza', 'telefono_contacto', 'categoria_estrellas'] },
  { titulo: 'Qué ofreces', subtitulo: 'Comodidades y fotos que verán los huéspedes.', campos: ['amenidades', 'imagenes'] },
  { titulo: 'Título y descripción', subtitulo: 'Cuenta en pocas palabras qué hace especial este alojamiento.', campos: ['nombre', 'descripcion'] },
  { titulo: 'Reservas y reglas', subtitulo: 'Política de cancelación y qué se espera de los huéspedes.', campos: ['politica_id', 'hora_silencio', 'reglas_extra'] },
  { titulo: 'Habitaciones y precios', subtitulo: 'Precio por noche y cuántas personas caben.', campos: [] },
  { titulo: 'Revisión', subtitulo: 'Revisa todo antes de guardar.', campos: [] },
];
const PASO_UNIDADES = 5;

/** Asistente por pasos para CREAR un alojamiento (la edición vive en EdicionAlojamientoComponent). */
@Component({
  selector: 'app-editor-alojamiento',
  imports: [
    ReactiveFormsModule, RouterLink, CurrencyPipe, AlertaErrorComponent, UnidadesNuevasComponent,
    SecTipoComponent, SecUbicacionComponent, SecHorariosComponent, SecReservasComponent, SecTextoComponent, SecAmenidadesComponent, SecFotosComponent,
  ],
  template: `
    <a routerLink="/admin" [queryParams]="{ tab: 'alojamientos' }" class="volver"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Volver a Alojamientos</span></a>
    <div class="asistente-cabecera"><h1>Nuevo alojamiento</h1></div>

    <nav class="progreso" aria-label="Pasos del asistente">
      <div class="progreso-barra" role="progressbar" aria-valuemin="1" [attr.aria-valuemax]="pasos.length" [attr.aria-valuenow]="paso() + 1"
           [attr.aria-valuetext]="'Paso ' + (paso() + 1) + ' de ' + pasos.length"><span [style.width.%]="((paso() + 1) / pasos.length) * 100"></span></div>
      <ol class="progreso-pasos siete">
        @for (p of pasos; track p.titulo; let i = $index) {
          <li [class.actual]="i === paso()" [class.hecho]="i < paso() && pasoValido(i)">
            <button type="button" (click)="ir(i)" [disabled]="i > alcanzado()" [attr.aria-current]="i === paso() ? 'step' : null">
              <span class="num" aria-hidden="true">{{ i < paso() && pasoValido(i) ? '✓' : i + 1 }}</span><span class="nombre">{{ p.titulo }}</span>
            </button>
          </li>
        }
      </ol>
    </nav>

    <form class="tarjeta asistente" [formGroup]="form" (ngSubmit)="guardar()" novalidate>
      <header class="paso-cabecera">
        <p class="paso-num">Paso {{ paso() + 1 }} de {{ pasos.length }}</p>
        <h2 id="titulo-paso" tabindex="-1">{{ pasos[paso()].titulo }}</h2>
        <p class="ayuda">{{ pasos[paso()].subtitulo }}</p>
      </header>
      <app-alerta-error [error]="error()" />

      <div class="paso-actual">
        @switch (paso()) {
          @case (0) {
            <fieldset class="bloque">
              <legend>¿Qué ofreces?</legend>
              <div class="opciones-tarjeta grandes" role="radiogroup" aria-label="Qué ofreces">
                <label class="opcion-tarjeta">
                  <input type="radio" name="modalidad" [checked]="modalidad() === 'COMPLETO'" (change)="elegirModalidad('COMPLETO')" />
                  <span class="icono" aria-hidden="true">🏠</span>
                  <span class="titulo">Todo el alojamiento</span>
                  <span class="detalle">Casa, cabaña o departamento completo. El huésped reserva el lugar entero.</span>
                </label>
                <label class="opcion-tarjeta">
                  <input type="radio" name="modalidad" [checked]="modalidad() === 'HABITACIONES'" (change)="elegirModalidad('HABITACIONES')" />
                  <span class="icono" aria-hidden="true">🛏️</span>
                  <span class="titulo">Varios tipos de habitación</span>
                  <span class="detalle">Hotel, hostal u hostería: cada tipo con su precio y cuántas tienes disponibles.</span>
                </label>
              </div>
            </fieldset>
            <app-sec-tipo [form]="form" />
            <app-sec-ubicacion [form]="form" />
          }
          @case (1) { <app-sec-horarios [form]="form" /> }
          @case (2) { <app-sec-amenidades [form]="form" /> <fieldset class="bloque"><legend>Fotos</legend><app-sec-fotos [form]="form" /></fieldset> }
          @case (3) { <app-sec-texto [form]="form" /> }
          @case (4) { <app-sec-reservas [form]="form" /> }
          @case (5) { <app-unidades-nuevas [lista]="unidades" [modalidad]="modalidad()" /> }
          @case (6) {
            <div class="revision">
              <section>
                <header><h3>Tipo y ubicación</h3><button type="button" class="btn-enlace" (click)="ir(0)">Editar</button></header>
                <dl>
                  <dt>Qué ofreces</dt><dd>{{ modalidad() === 'COMPLETO' ? 'Todo el alojamiento' : 'Varios tipos de habitación' }}</dd>
                  <dt>Tipo</dt><dd>{{ nombreTipo() || '—' }}</dd>
                  <dt>Ciudad</dt><dd>{{ etiquetaCiudad() || '—' }}</dd>
                  <dt>Dirección</dt><dd>{{ form.controls.direccion.value || '—' }}</dd>
                  <dt>Mapa</dt><dd>{{ form.controls.latitud.valid ? '✓ Ubicación marcada' : '✗ Falta ubicar el pin' }}</dd>
                </dl>
              </section>
              <section>
                <header><h3>Lo básico</h3><button type="button" class="btn-enlace" (click)="ir(1)">Editar</button></header>
                <dl>
                  <dt>Check-in / out</dt><dd>desde {{ form.controls.hora_checkin.value }} · hasta {{ form.controls.hora_checkout.value }}</dd>
                  <dt>Noches</dt><dd>{{ form.controls.noches_min.value }} a {{ form.controls.noches_max.value }}</dd>
                  <dt>Limpieza</dt><dd>{{ (form.controls.tarifa_limpieza.value ?? 0) | currency: 'USD' }} por reserva</dd>
                  <dt>Teléfono</dt><dd>{{ form.controls.telefono_contacto.value || '—' }}</dd>
                </dl>
              </section>
              <section>
                <header><h3>Qué ofreces</h3><button type="button" class="btn-enlace" (click)="ir(2)">Editar</button></header>
                <dl><dt>Amenidades</dt><dd>{{ nombresAmenidades() || 'Ninguna' }}</dd><dt>Fotos</dt><dd>{{ fotos().length }}</dd></dl>
                @if (fotos().length) {
                  <ul class="vista-fotos chica">
                    @for (u of fotos().slice(0, 6); track u + $index) { <li>@if (esHttps(u)) { <img [src]="u" alt="" loading="lazy" /> } @else { <div class="foto-rota">✗</div> }</li> }
                  </ul>
                }
              </section>
              <section>
                <header><h3>Título y descripción</h3><button type="button" class="btn-enlace" (click)="ir(3)">Editar</button></header>
                <p><strong>{{ form.controls.nombre.value || '—' }}</strong></p>
                <p class="texto recortado">{{ form.controls.descripcion.value || '—' }}</p>
              </section>
              <section>
                <header><h3>Reservas y reglas</h3><button type="button" class="btn-enlace" (click)="ir(4)">Editar</button></header>
                <dl>
                  <dt>Confirmación</dt><dd>Inmediata, al aprobarse el pago</dd>
                  <dt>Cancelación</dt><dd>{{ nombrePolitica() || '—' }}</dd>
                  <dt>Reglas</dt><dd>{{ reglas() || 'Sin reglas especiales' }}</dd>
                </dl>
              </section>
              <section>
                <header><h3>Habitaciones y precios</h3><button type="button" class="btn-enlace" (click)="ir(5)">Editar</button></header>
                <ul class="resumen-unidades">
                  @for (u of resumenUnidades(); track $index) { <li>{{ u }}</li> }
                </ul>
              </section>
            </div>
            <p class="nota">Se guardará como <strong>borrador</strong> a nombre de Posada EC: nadie lo verá hasta que lo publiques desde Alojamientos.</p>
          }
        }
      </div>

      <footer class="asistente-pie d-flex justify-content-between gap-3 mt-4">
        <a class="btn" routerLink="/admin" [queryParams]="{ tab: 'alojamientos' }">Cancelar</a>
        <button class="btn" type="button" (click)="atras()" [disabled]="paso() === 0">Atrás</button>
        @if (paso() < pasos.length - 1) {
          <button class="btn btn-secundario" type="button" (click)="siguiente()" [disabled]="!pasoValido(paso())">Siguiente</button>
        } @else {
          <button class="btn btn-primario" type="submit" [disabled]="guardando() || !todoValido()">{{ guardando() ? 'Guardando…' : 'Crear borrador' }}</button>
        }
      </footer>
    </form>
  `,
})
export class EditorAlojamientoComponent implements ConCambiosSinGuardar {
  private readonly api = inject(AnfitrionService);
  private readonly router = inject(Router);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(FormBuilder);
  readonly c = toSignal(inject(CatalogoService).constantes());
  readonly pasos = PASOS;

  readonly paso = signal(0);
  readonly alcanzado = signal(0);
  readonly guardando = signal(false);
  readonly error = signal<ErrorVista | null>(null);
  readonly modalidad = signal<Modalidad>('COMPLETO');
  private modalidadElegida = false;
  private creado = false;

  readonly form = crearFormAlojamiento(this.fb);
  readonly unidades = this.fb.array<FormUnidad>([grupoUnidad(this.fb, { nombre: 'Todo el alojamiento' })]);
  private readonly valores = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  readonly fotos = computed(() => urlsDe(this.valores().imagenes ?? ''));
  readonly etiquetaCiudad = computed(() => {
    const ci = (this.c()?.cities ?? []).find((x) => x.id === this.valores().ciudad_id);
    return ci ? `${ci.name}, ${ci.province}` : '';
  });
  readonly nombreTipo = computed(() => (this.c()?.accommodation_types ?? []).find((t) => t.id === this.valores().tipo_id)?.name ?? '');
  readonly nombrePolitica = computed(() => {
    const p = (this.c()?.cancellation_policies ?? []).find((x) => x.id === this.valores().politica_id);
    return p ? `${NOMBRE_POLITICA[p.name]?.titulo ?? p.name}: ${p.description}` : '';
  });
  readonly nombresAmenidades = computed(() => {
    const ids = this.valores().amenidades ?? [];
    return (this.c()?.facilities ?? []).filter((a) => ids.includes(a.id)).map((a) => a.name).join(', ');
  });
  readonly reglas = computed(() => reglasTexto(this.valores()));

  constructor() {
    enlazarForm(this.form);
    // Sugiere "todo el alojamiento" o "habitaciones" según el tipo, mientras el usuario no haya elegido a mano
    this.form.controls.tipo_id.valueChanges.subscribe((id) => {
      if (this.modalidadElegida) return;
      const nombre = (this.c()?.accommodation_types ?? []).find((t) => t.id === id)?.name ?? '';
      this.aplicarModalidad(TIPOS_COMPLETOS.includes(nombre) ? 'COMPLETO' : 'HABITACIONES');
    });
  }

  // ---------- Cambios sin guardar ----------
  hayCambiosSinGuardar(): boolean {
    return !this.creado && (this.form.dirty || this.unidades.dirty);
  }
  @HostListener('window:beforeunload', ['$event'])
  avisarAlCerrar(ev: BeforeUnloadEvent): void {
    if (this.hayCambiosSinGuardar()) ev.preventDefault();
  }

  // ---------- Modalidad ----------
  elegirModalidad(m: Modalidad): void {
    this.modalidadElegida = true;
    this.aplicarModalidad(m);
    this.form.markAsDirty();
  }
  private aplicarModalidad(m: Modalidad): void {
    this.modalidad.set(m);
    if (m === 'COMPLETO') {
      while (this.unidades.length > 1) this.unidades.removeAt(this.unidades.length - 1);
      this.unidades.at(0).patchValue({ cantidad: 1, nombre: 'Todo el alojamiento' });
    } else if (this.unidades.at(0).controls.nombre.value === 'Todo el alojamiento') {
      this.unidades.at(0).patchValue({ nombre: '' });
    }
  }
  readonly resumenUnidades = computed(() => {
    this.valores();
    return this.unidades.getRawValue().map((u) =>
      this.modalidad() === 'COMPLETO'
        ? `Todo el alojamiento · hasta ${u.capacidad_huespedes} huéspedes · USD ${Number(u.precio_noche_base ?? 0).toFixed(2)} por noche`
        : `${u.nombre || '(sin nombre)'} · ${u.cantidad} disponible${Number(u.cantidad) === 1 ? '' : 's'} · hasta ${u.capacidad_huespedes} huéspedes · USD ${Number(u.precio_noche_base ?? 0).toFixed(2)} por noche`,
    );
  });

  // ---------- Navegación ----------
  pasoValido(i: number): boolean {
    if (i === PASO_UNIDADES) return this.unidades.valid;
    return PASOS[i].campos.every((n) => this.form.get(n)?.valid ?? true);
  }
  todoValido(): boolean {
    this.valores();
    return PASOS.every((_, i) => this.pasoValido(i));
  }
  ir(i: number): void {
    if (i > this.alcanzado()) return;
    this.paso.set(i);
    this.enfocarTitulo();
  }
  atras(): void {
    if (this.paso() > 0) this.ir(this.paso() - 1);
  }
  siguiente(): void {
    if (!this.validarPaso(this.paso())) return;
    const sig = this.paso() + 1;
    this.alcanzado.update((a) => Math.max(a, sig));
    this.paso.set(sig);
    this.enfocarTitulo();
  }
  private validarPaso(i: number): boolean {
    if (i === PASO_UNIDADES) this.unidades.markAllAsTouched();
    for (const n of PASOS[i].campos) this.form.get(n)?.markAllAsTouched();
    if (this.pasoValido(i)) return true;
    this.enfocarError();
    return false;
  }
  private enfocarTitulo(): void {
    setTimeout(() => {
      this.raiz.nativeElement.querySelector<HTMLElement>('#titulo-paso')?.focus();
      this.raiz.nativeElement.querySelector('.progreso')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  private enfocarError(): void {
    setTimeout(() => {
      const r = this.raiz.nativeElement;
      const el = r.querySelector<HTMLElement>('.paso-actual [aria-invalid="true"]') ?? r.querySelector<HTMLElement>('.paso-actual .msg-error');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus?.();
    });
  }
  esHttps(u: string): boolean {
    return esUrlHttps(u);
  }

  // ---------- Guardar: borrador + unidades ----------
  guardar(): void {
    for (let i = 0; i < PASOS.length - 1; i++) {
      if (!this.validarPaso(i)) {
        this.paso.set(i);
        return;
      }
    }
    this.guardando.set(true);
    this.error.set(null);
    const nombreAloj = (this.form.controls.nombre.value ?? '').trim();
    const unidades = this.unidades.getRawValue().map((u) => ({
      nombre: this.modalidad() === 'COMPLETO' ? (nombreAloj.length >= 2 ? nombreAloj : 'Todo el alojamiento').slice(0, L.unidad.nombre.max) : (u.nombre ?? '').trim(),
      capacidad_huespedes: Number(u.capacidad_huespedes), num_habitaciones: Number(u.num_habitaciones), num_camas: Number(u.num_camas),
      num_banos: Number(u.num_banos), cantidad: this.modalidad() === 'COMPLETO' ? 1 : Number(u.cantidad), precio_noche_base: Number(u.precio_noche_base),
    }));
    this.api.crear(datosDe(this.form) as DatosAlojamiento).subscribe({
      next: (r) => {
        this.creado = true;
        // Unidades una tras otra; si alguna falla, el borrador ya existe y se avisa en la pantalla de edición
        from(unidades).pipe(concatMap((u) => this.api.crearUnidad(r.codigo, u)), toArray()).subscribe({
          next: () => this.irAEdicion(r.codigo, false),
          error: () => this.irAEdicion(r.codigo, true),
        });
      },
      error: (e) => {
        this.guardando.set(false);
        const err = leerError(e);
        const ubicados = ubicarErroresApi(this.form, err.campos, traducirMotivoApi);
        const paso = PASOS.findIndex((p) => p.campos.some((c) => ubicados.includes(c)));
        if (paso >= 0) {
          this.paso.set(paso);
          this.enfocarError();
        } else {
          this.error.set(err);
        }
      },
    });
  }

  private irAEdicion(codigo: number, falloUnidades: boolean): void {
    this.guardando.set(false);
    this.router.navigate(['/admin/alojamientos', codigo], { queryParams: falloUnidades ? { creado: 1, unidades: 'fallo' } : { creado: 1 } });
  }
}
