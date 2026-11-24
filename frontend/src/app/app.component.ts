import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';
import { ConfirmarComponent, ConfirmarService } from './shared/confirmar';
import { LoginModalComponent } from './features/auth/login-modal.component';
import { LoginModalService } from './core/services/login-modal.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmarComponent, LoginModalComponent],
  template: `
    <a class="saltar" href="#contenido">Saltar al contenido</a>
    <header class="barra">
      <a routerLink="/" class="marca" aria-label="PosadaEC, inicio">Posada<span>EC</span></a>
      <button #menuBtn class="menu-btn" type="button" (click)="menu.set(!menu())" [attr.aria-expanded]="menu()" aria-controls="nav">Menú</button>
      <!-- Clic en un enlace del menú móvil lo cierra y Esc también; los enlaces ya son accesibles con teclado -->
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
      <nav id="nav" [class.abierto]="menu()" (click)="menu.set(false)" (keydown.escape)="cerrarMenu(menuBtn)" aria-label="Principal">
        <a class="ni ni-buscar" routerLink="/" routerLinkActive="activo" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }">Buscar</a>
        @if (auth.usuario(); as u) {
          @if (u.rol === 'ADMIN') {
            <a class="ni ni-admin" routerLink="/admin" routerLinkActive="activo" ariaCurrentWhenActive="page">Administración</a>
          } @else {
            <a class="ni ni-reservas" routerLink="/mis-reservas" routerLinkActive="activo" ariaCurrentWhenActive="page">Mis reservas</a>
          }
          <!-- El ADMIN no tiene "Mi perfil" ni nombre en la barra -->
          @if (u.rol !== 'ADMIN') {
            <a class="nav-usuario d-inline-flex align-items-center" routerLink="/perfil" routerLinkActive="activo" ariaCurrentWhenActive="page" title="Mi perfil" [attr.aria-label]="'Mi perfil: ' + u.nombres">
              <span class="nav-avatar" aria-hidden="true">{{ (u.nombres.charAt(0) + u.apellidos.charAt(0)).toUpperCase() }}</span>
              {{ u.nombres }}
            </a>
          }
          <button class="btn-salir ni ni-salir" type="button" (click)="salir()">Salir</button>
        } @else {
          <button class="nav-boton ni ni-entrar" type="button" (click)="abrirLogin()" aria-haspopup="dialog">Iniciar sesión</button>
          <a routerLink="/registro" class="btn btn-primario">Crear cuenta</a>
        }
      </nav>
    </header>
    <main id="contenido" class="contenedor" tabindex="-1">
      <router-outlet />
    </main>
    <footer class="pie-pagina">
      <p class="pie-marca">© 2026 Posada EC · Proyecto académico PUCE</p>
      <p class="pie-aviso">Los pagos y facturas son simulados con fines académicos.</p>
      <p class="pie-aviso"><a class="pie-enlace" routerLink="/observabilidad">Observabilidad</a></p>
    </footer>
    <app-confirmar />
    <app-login-modal />
  `,
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly menu = signal(false);

  /** Esc en el menú móvil abierto: lo cierra y devuelve el foco al botón "Menú". */
  cerrarMenu(boton: HTMLButtonElement): void {
    if (!this.menu()) return;
    this.menu.set(false);
    boton.focus();
  }
  private readonly confirmar = inject(ConfirmarService);
  private readonly loginModal = inject(LoginModalService);
  private readonly router = inject(Router);
  private rutaAnterior: string | null = null;

  constructor() {
    // Accesibilidad (WCAG 2.4.3): al cambiar de PÁGINA se lleva el foco al contenido principal.
    // Solo si cambia la ruta (no los parámetros de búsqueda) y no en la primera carga, para no robar el foco al escribir.
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const ruta = e.urlAfterRedirects.split(/[?#]/)[0];
      if (this.rutaAnterior !== null && ruta !== this.rutaAnterior) document.getElementById('contenido')?.focus({ preventScroll: true });
      this.rutaAnterior = ruta;
    });
  }

  /** Abre la ventana de inicio de sesión; al entrar, vuelve a la página actual (desde el inicio, a la de siempre según el rol). */
  abrirLogin(): void {
    this.loginModal.abrir(this.router.url === '/' ? null : this.router.url);
  }

  /** Cierra la sesión solo si el usuario lo confirma en el diálogo común. */
  async salir(): Promise<void> {
    const si = await this.confirmar.pedir({
      titulo: '¿Cerrar sesión?',
      mensaje: '¿Seguro que quieres cerrar sesión?',
      confirmar: 'Cerrar sesión',
      cancelar: 'Cancelar',
      tono: 'peligro',
    });
    if (si) this.auth.logout();
  }
}
