import { Injectable, signal } from '@angular/core';

/**
 * Estado de la ventana de inicio de sesión (una sola, montada en AppComponent).
 * Se abre desde la barra, desde "Reservar" sin sesión y al entrar a /login (al que redirigen los guards con ?volver=).
 */
@Injectable({ providedIn: 'root' })
export class LoginModalService {
  readonly abierto = signal(false);
  /** Ruta a la que se vuelve tras iniciar sesión (null = la de siempre según el rol). */
  readonly volver = signal<string | null>(null);
  /** Elemento que tenía el foco al abrir: recibe el foco de vuelta al cerrar. */
  origen: HTMLElement | null = null;

  abrir(volver: string | null = null): void {
    if (!this.abierto()) this.origen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.volver.set(volver && volver.startsWith('/') && !volver.startsWith('//') && !volver.includes(':') && !volver.startsWith('/login') ? volver : null);
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }
}
