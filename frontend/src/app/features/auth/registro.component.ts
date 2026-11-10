import { Component, ElementRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RegistroDatos } from '../../core/models/api.models';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AuthService } from '../../core/services/auth.service';
import { CampoMensajeComponent, conError, OjoClaveComponent, RequisitosClaveComponent } from '../../shared/campo';
import { AlertaErrorComponent } from '../../shared/ui';
import { FiltroDirective } from '../../shared/entrada';
import {
  aplicarErroresApi, LIMITES, normalizarEmail, normalizarNombre, revisarYEnfocar, vClave, vEmail, vIgualA, vNombre,
} from '../../shared/validadores';

/** 409 del registro: se muestra bajo el campo correo con el texto del backend ("Ya existe una cuenta con este correo"). */
export const MENSAJE_CORREO_DUPLICADO = 'Ya existe una cuenta con este correo';
export const mensajeCorreoDuplicado = (detalle?: string): string => (detalle?.trim() ? detalle.trim() : MENSAJE_CORREO_DUPLICADO);

@Component({
  selector: 'app-registro',
  imports: [ReactiveFormsModule, RouterLink, AlertaErrorComponent, CampoMensajeComponent, RequisitosClaveComponent, OjoClaveComponent, FiltroDirective],
  template: `
    <section class="tarjeta auth">
      <h1>Crear cuenta</h1>
      <p class="ayuda">Con tu cuenta puedes buscar, reservar, pagar, ver tus reservas y dejar reseñas.</p>
      <app-alerta-error [error]="errorGeneral()" />
      <form [formGroup]="form" (ngSubmit)="enviar()" novalidate>
        <div class="fila">
          <div class="grupo">
            <label for="reg-nombres">Nombres</label>
            <input id="reg-nombres" appFiltro="nombre" formControlName="nombres" autocomplete="given-name" [maxlength]="L.nombre.max"
                   [attr.aria-invalid]="mal('nombres')" aria-describedby="msg-nombres" (blur)="limpiarNombre('nombres')" />
            <app-campo-mensaje [control]="form.controls.nombres" id="msg-nombres" />
          </div>
          <div class="grupo">
            <label for="reg-apellidos">Apellidos</label>
            <input id="reg-apellidos" appFiltro="nombre" formControlName="apellidos" autocomplete="family-name" [maxlength]="L.nombre.max"
                   [attr.aria-invalid]="mal('apellidos')" aria-describedby="msg-apellidos" (blur)="limpiarNombre('apellidos')" />
            <app-campo-mensaje [control]="form.controls.apellidos" id="msg-apellidos" />
          </div>
        </div>

        <div class="grupo">
          <label for="reg-email">Correo</label>
          <input id="reg-email" type="email" formControlName="email" autocomplete="email" inputmode="email" [maxlength]="L.email"
                 placeholder="nombre@correo.com" [attr.aria-invalid]="mal('email')" aria-describedby="msg-email" />
          <app-campo-mensaje [control]="form.controls.email" id="msg-email" />
        </div>

        <div class="grupo">
          <label for="reg-clave">Clave</label>
          <app-ojo-clave #ojo>
            <input id="reg-clave" [type]="ojo.visible() ? 'text' : 'password'" formControlName="password" autocomplete="new-password"
                   [maxlength]="L.clave.max" [attr.aria-invalid]="mal('password')" aria-describedby="req-clave msg-password" />
          </app-ojo-clave>
          <app-requisitos-clave [valor]="form.controls.password.value" [tocado]="form.controls.password.touched" id="req-clave" />
          <app-campo-mensaje [control]="form.controls.password" id="msg-password" />
        </div>

        <div class="grupo">
          <label for="reg-repetir">Repetir clave</label>
          <app-ojo-clave #ojo2>
            <input id="reg-repetir" [type]="ojo2.visible() ? 'text' : 'password'" formControlName="repetir" autocomplete="new-password"
                   [maxlength]="L.clave.max" [attr.aria-invalid]="mal('repetir')" aria-describedby="msg-repetir" />
          </app-ojo-clave>
          <app-campo-mensaje [control]="form.controls.repetir" id="msg-repetir" />
        </div>

        <button class="btn btn-primario" type="submit" [disabled]="enviando()">{{ enviando() ? 'Registrando…' : 'Registrarme' }}</button>
      </form>
      <p class="pie">¿Ya tienes cuenta? <a routerLink="/login">Inicia sesión</a></p>
    </section>
  `,
})
export class RegistroComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly L = LIMITES;
  /** Errores que no corresponden a un campo concreto (red, 500, 429…). */
  readonly errorGeneral = signal<ErrorVista | null>(null);
  readonly enviando = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    nombres: ['', vNombre('nombres')],
    apellidos: ['', vNombre('apellidos')],
    email: ['', vEmail()],
    password: ['', vClave],
    repetir: ['', vIgualA('password')],
  });

  constructor() {
    // Si cambia la clave, "Repetir clave" se vuelve a comparar
    this.form.controls.password.valueChanges.subscribe(() => this.form.controls.repetir.updateValueAndValidity({ emitEvent: false }));
  }

  mal(campo: 'nombres' | 'apellidos' | 'email' | 'password' | 'repetir'): boolean {
    return conError(this.form.controls[campo]);
  }

  limpiarNombre(campo: 'nombres' | 'apellidos'): void {
    const c = this.form.controls[campo];
    const n = normalizarNombre(c.value);
    if (n !== c.value) c.setValue(n);
  }

  enviar(): void {
    this.errorGeneral.set(null);
    if (!revisarYEnfocar(this.form, this.raiz.nativeElement)) return;
    const v = this.form.getRawValue();
    const datos: RegistroDatos = {
      nombres: normalizarNombre(v.nombres),
      apellidos: normalizarNombre(v.apellidos),
      email: normalizarEmail(v.email),
      password: v.password,
    };
    this.enviando.set(true);
    this.auth.registrar(datos).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: (e) => {
        this.enviando.set(false);
        const error = leerError(e);
        if (error.status === 409) {
          this.form.controls.email.setErrors({ api: mensajeCorreoDuplicado(error.mensaje) });
          this.form.controls.email.markAsTouched();
        } else if (error.status !== 400 || !aplicarErroresApi(this.form, error.campos)) {
          this.errorGeneral.set(error);
        }
        revisarYEnfocar(this.form, this.raiz.nativeElement);
      },
    });
  }
}
