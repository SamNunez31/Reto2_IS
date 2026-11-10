import { Component, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AuthService } from '../../core/services/auth.service';
import { LoginModalService } from '../../core/services/login-modal.service';
import { CampoMensajeComponent, conError, OjoClaveComponent } from '../../shared/campo';
import { AlertaErrorComponent } from '../../shared/ui';
import { LIMITES, normalizarEmail, revisarYEnfocar, vEmail, vRequerido } from '../../shared/validadores';

/** Ruta /login (con o sin ?volver=): muestra la página de inicio con esta ventana encima. */
const esRutaLogin = (url: string): boolean => /^\/login(?:[?#]|$)/.test(url);

/**
 * Inicio de sesión en ventana emergente. Mismo patrón que shared/confirmar.ts: <dialog> modal nativo
 * (foco atrapado, fondo inerte, Esc = cerrar) y el foco vuelve al botón que la abrió.
 */
@Component({
  selector: 'app-login-modal',
  imports: [ReactiveFormsModule, AlertaErrorComponent, CampoMensajeComponent, OjoClaveComponent],
  template: `
    <!-- Clic en el fondo = cerrar; con teclado se cierra con Esc (evento cancel del <dialog>) o con el botón × -->
    <!-- El <dialog> modal recibe y atrapa el foco por sí mismo (showModal) -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog #dialogo class="dialogo dialogo-login" aria-labelledby="login-titulo" aria-describedby="login-subtitulo"
            (cancel)="$event.preventDefault(); cancelar()" (click)="clicFondo($event)">
      @if (svc.abierto()) {
        <div class="dialogo-cuerpo">
          <button type="button" class="dialogo-cerrar" (click)="cancelar()" aria-label="Cerrar" title="Cerrar"><span aria-hidden="true">×</span></button>
          <p class="login-antetitulo">Bienvenido a tu próxima escapada</p>
          <h2 id="login-titulo">Qué bueno verte.</h2>
          <p id="login-subtitulo" class="login-subtitulo">Inicia sesión para reservar y gestionar tus viajes.</p>
          <app-alerta-error [error]="error()" />
          <form [formGroup]="form" (ngSubmit)="enviar()" novalidate>
            <div class="grupo">
              <label for="login-email">Correo</label>
              <input id="login-email" type="email" formControlName="email" autocomplete="email" inputmode="email" [maxlength]="L.email"
                     placeholder="nombre@correo.com" [attr.aria-invalid]="mal('email')" aria-describedby="msg-login-email" />
              <app-campo-mensaje [control]="form.controls.email" id="msg-login-email" [mostrarOk]="false" />
            </div>
            <div class="grupo">
              <label for="login-clave">Contraseña</label>
              <app-ojo-clave #ojo>
                <input id="login-clave" [type]="ojo.visible() ? 'text' : 'password'" formControlName="password" autocomplete="current-password"
                       [maxlength]="L.clave.max" [attr.aria-invalid]="mal('password')" aria-describedby="msg-login-clave" />
              </app-ojo-clave>
              <app-campo-mensaje [control]="form.controls.password" id="msg-login-clave" [mostrarOk]="false" />
            </div>
            <div class="login-acciones">
              <button class="btn btn-primario" type="submit" [disabled]="enviando()">{{ enviando() ? 'Iniciando sesión…' : 'Iniciar sesión' }}</button>
              <button class="btn" type="button" (click)="irARegistro()">Registrarme</button>
            </div>
          </form>
        </div>
      }
    </dialog>
  `,
})
export class LoginModalComponent {
  readonly svc = inject(LoginModalService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  readonly L = LIMITES;
  readonly error = signal<ErrorVista | null>(null);
  readonly enviando = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', vEmail()],
    // En login solo se exige que no esté vacía: no se revela nada de la política ni de la cuenta
    password: ['', vRequerido('Ingresa tu contraseña')],
  });

  constructor() {
    // /login (también al que redirigen los guards con ?volver=) abre la ventana sobre la página de inicio
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((e) => {
        if (esRutaLogin(e.urlAfterRedirects)) this.svc.abrir(this.router.parseUrl(e.urlAfterRedirects).queryParamMap.get('volver'));
      });

    effect(() => {
      const abierto = this.svc.abierto();
      const d = this.dialogo().nativeElement;
      if (abierto && !d.open) {
        this.form.reset({ email: '', password: '' });
        this.error.set(null);
        this.enviando.set(false);
        d.showModal();
        setTimeout(() => d.querySelector<HTMLInputElement>('#login-email')?.focus());
      } else if (!abierto && d.open) {
        d.close();
        const origen = this.svc.origen;
        this.svc.origen = null;
        if (origen?.isConnected && origen !== document.body) origen.focus();
      }
    });
  }

  mal(campo: 'email' | 'password'): boolean {
    return conError(this.form.controls[campo]);
  }

  /** Cerrar sin iniciar sesión (×, Esc o clic en el fondo). En /login se queda en la página de inicio. */
  cancelar(): void {
    this.svc.cerrar();
    if (esRutaLogin(this.router.url)) this.router.navigateByUrl('/', { replaceUrl: true });
  }

  clicFondo(ev: MouseEvent): void {
    if (ev.target === this.dialogo().nativeElement) this.cancelar();
  }

  irARegistro(): void {
    this.svc.origen = null;
    this.svc.cerrar();
    this.router.navigateByUrl('/registro');
  }

  enviar(): void {
    this.error.set(null);
    if (!revisarYEnfocar(this.form, this.dialogo().nativeElement)) return;
    this.enviando.set(true);
    const { email, password } = this.form.getRawValue();
    this.auth.login(normalizarEmail(email), password).subscribe({
      next: (u) => {
        const volver = this.svc.volver();
        this.svc.origen = null;
        this.svc.cerrar();
        this.enviando.set(false);
        // Vuelve a donde el usuario quería ir; si no, la página de siempre según el rol
        this.router.navigateByUrl(volver ?? (u.rol === 'ADMIN' ? '/admin' : esRutaLogin(this.router.url) ? '/' : this.router.url));
      },
      error: (e) => {
        const error = leerError(e);
        // 401: mensaje único, sin decir si falló el correo o la clave
        this.error.set(error.status === 401 ? { ...error, mensaje: 'Correo o contraseña incorrectos. Revisa los datos e inténtalo de nuevo.', campos: {} } : error);
        this.enviando.set(false);
      },
    });
  }
}
