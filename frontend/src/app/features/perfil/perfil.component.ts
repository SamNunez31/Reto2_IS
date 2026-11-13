import { DatePipe, Location } from '@angular/common';
import { Component, computed, ElementRef, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { CambiosPerfil, PerfilService } from '../../core/services/perfil.service';
import { CampoMensajeComponent, conError } from '../../shared/campo';
import { avisoTemporal } from '../../shared/aviso';
import { FiltroDirective } from '../../shared/entrada';
import { TelefonoDirective } from '../../shared/telefono.directive';
import { AlertaErrorComponent, CargandoComponent } from '../../shared/ui';
import {
  aplicarErroresApi, LIMITES, normalizarNombre, normalizarTelefono, PISTA_TELEFONO, revisarYEnfocar, vNombre, vTelefono,
} from '../../shared/validadores';

type Campo = 'nombres' | 'apellidos' | 'telefono';

/**
 * Perfil: nombre y teléfono. Los datos de facturación (cédula, RUC, pasaporte) ya no se piden aquí:
 * se ingresan en cada pago y solo quedan en la factura.
 */
@Component({
  selector: 'app-perfil',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, AlertaErrorComponent, CargandoComponent, CampoMensajeComponent, TelefonoDirective, FiltroDirective],
  template: `
    <section class="tarjeta perfil">
      <header class="perfil-cabecera">
        <div class="perfil-avatar" aria-hidden="true">{{ iniciales() }}</div>
        <div class="perfil-id">
          <h1>{{ nombreCompleto() || 'Mi perfil' }}</h1>
          <p class="perfil-correo">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
            {{ email() }}
          </p>
          <p class="perfil-etiquetas">
            @if (rol()) { <span class="etiqueta-rol">{{ rol() }}</span> }
            @if (desde()) { <span class="perfil-desde">Miembro desde {{ desde() | date: 'MMMM y' : '' : 'es-EC' }}</span> }
          </p>
        </div>
      </header>
      @if (cargando()) { <app-cargando /> }
      <app-alerta-error [error]="error()" />
      <form [formGroup]="form" (ngSubmit)="guardar()" novalidate>
        <h2 class="perfil-seccion">Datos personales</h2>
        <div class="fila">
          <div class="grupo">
            <label for="per-nombres">Nombres</label>
            <input id="per-nombres" appFiltro="nombre" formControlName="nombres" autocomplete="given-name" [maxlength]="L.nombre.max"
                   [attr.aria-invalid]="mal('nombres')" aria-describedby="msg-per-nombres" (blur)="limpiarNombre('nombres')" />
            <app-campo-mensaje [control]="form.controls.nombres" id="msg-per-nombres" />
          </div>
          <div class="grupo">
            <label for="per-apellidos">Apellidos</label>
            <input id="per-apellidos" appFiltro="nombre" formControlName="apellidos" autocomplete="family-name" [maxlength]="L.nombre.max"
                   [attr.aria-invalid]="mal('apellidos')" aria-describedby="msg-per-apellidos" (blur)="limpiarNombre('apellidos')" />
            <app-campo-mensaje [control]="form.controls.apellidos" id="msg-per-apellidos" />
          </div>
        </div>
        <h2 class="perfil-seccion">Contacto</h2>
        <div class="grupo">
          <label for="per-telefono">Teléfono (opcional)</label>
          <input id="per-telefono" appTelefono formControlName="telefono" placeholder="0991234567"
                 [attr.aria-invalid]="mal('telefono')" aria-describedby="ayuda-per-telefono msg-per-telefono" />
          <small id="ayuda-per-telefono" class="ayuda">{{ pistaTelefono }}</small>
          <app-campo-mensaje [control]="form.controls.telefono" id="msg-per-telefono" />
        </div>
        <div class="acciones perfil-acciones">
          <button class="btn btn-primario" type="submit" [disabled]="enviando() || cargando() || !hayCambios() || form.invalid"
                  [attr.aria-describedby]="!hayCambios() ? 'per-sin-cambios' : null">{{ enviando() ? 'Guardando…' : 'Guardar' }}</button>
          <button class="btn" type="button" (click)="cancelar()" [disabled]="enviando()">Cancelar</button>
        </div>
        @if (!hayCambios() && !cargando()) { <small id="per-sin-cambios" class="ayuda">No hay cambios por guardar.</small> }
        @if (ok.texto()) { <p class="aviso-guardado ok" role="status">✓ {{ ok.texto() }}</p> }
      </form>
      <p class="perfil-enlace"><a routerLink="/mis-reservas">Ver mis reservas →</a></p>
    </section>
  `,
})
export class PerfilComponent implements OnInit {
  private readonly perfil = inject(PerfilService);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly L = LIMITES;
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly email = signal('');
  readonly rol = signal('');
  readonly desde = signal('');
  readonly error = signal<ErrorVista | null>(null);
  readonly ok = avisoTemporal();
  readonly pistaTelefono = PISTA_TELEFONO;
  readonly form = inject(FormBuilder).nonNullable.group({
    nombres: ['', vNombre('nombres')],
    apellidos: ['', vNombre('apellidos')],
    telefono: ['', vTelefono],
  });
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  /** Últimos valores guardados (o cargados): Cancelar vuelve a ellos y sirven para saber si hay cambios. */
  private readonly guardado = signal({ nombres: '', apellidos: '', telefono: '' });
  private readonly valores = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly nombreCompleto = computed(() => `${this.guardado().nombres} ${this.guardado().apellidos}`.trim());
  readonly iniciales = computed(() => {
    const g = this.guardado();
    const i = `${g.nombres.trim().charAt(0)}${g.apellidos.trim().charAt(0)}`.toUpperCase();
    return i || (this.email().charAt(0).toUpperCase() || '?');
  });
  readonly hayCambios = computed(() => {
    this.valores();
    const v = this.form.getRawValue();
    const g = this.guardado();
    return normalizarNombre(v.nombres) !== g.nombres || normalizarNombre(v.apellidos) !== g.apellidos
      || normalizarTelefono(v.telefono.trim()) !== normalizarTelefono(g.telefono);
  });

  ngOnInit(): void {
    this.perfil.obtener().subscribe({
      next: (p) => {
        this.email.set(p.email);
        this.rol.set(p.rol === 'ADMIN' ? 'Administrador' : p.es_anfitrion ? 'Anfitrión' : 'Huésped');
        this.desde.set(p.created_at ?? '');
        const datos = { nombres: p.nombres, apellidos: p.apellidos, telefono: p.telefono ?? '' };
        this.guardado.set(datos);
        this.form.reset(datos);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(leerError(e));
        this.cargando.set(false);
      },
    });
  }

  mal(campo: Campo): boolean {
    return conError(this.form.controls[campo]);
  }

  limpiarNombre(campo: 'nombres' | 'apellidos'): void {
    const c = this.form.controls[campo];
    const n = normalizarNombre(c.value);
    if (n !== c.value) c.setValue(n);
  }

  /** Descarta lo escrito (vuelve a lo guardado) y regresa a la página anterior, o al inicio si se entró directo. */
  cancelar(): void {
    this.form.reset(this.guardado());
    this.error.set(null);
    if (this.router.lastSuccessfulNavigation?.previousNavigation) this.location.back();
    else this.router.navigateByUrl('/');
  }

  guardar(): void {
    this.error.set(null);
    this.ok.limpiar();
    if (!revisarYEnfocar(this.form, this.raiz.nativeElement)) return;
    const v = this.form.getRawValue();
    // Solo nombre y teléfono: el documento del perfil no se envía ni se modifica
    const cambios: CambiosPerfil = { nombres: normalizarNombre(v.nombres), apellidos: normalizarNombre(v.apellidos) };
    if (v.telefono.trim()) cambios.telefono = normalizarTelefono(v.telefono.trim());
    this.enviando.set(true);
    this.perfil.actualizar(cambios).subscribe({
      next: () => {
        this.guardado.set({ nombres: cambios.nombres ?? '', apellidos: cambios.apellidos ?? '', telefono: cambios.telefono ?? '' });
        this.form.reset(this.guardado());
        this.ok.mostrar('Datos actualizados');
        this.enviando.set(false);
      },
      error: (e) => {
        const error = leerError(e);
        if (error.status !== 400 || !aplicarErroresApi(this.form, error.campos)) this.error.set(error);
        this.enviando.set(false);
        revisarYEnfocar(this.form, this.raiz.nativeElement);
      },
    });
  }
}
