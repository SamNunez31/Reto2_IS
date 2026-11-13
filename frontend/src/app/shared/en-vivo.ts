import { DestroyRef } from '@angular/core';

/**
 * Repite `accion` cada `ms` mientras la pestaña del navegador está visible y la ejecuta
 * al volver a verla. Se detiene sola cuando se destruye el componente.
 * Úsalo para refrescar datos "en vivo" sin botones de actualizar.
 */
export function enVivo(destroyRef: DestroyRef, accion: () => void, ms: number): void {
  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
  const id = setInterval(() => { if (visible()) accion(); }, ms);
  const alVolver = () => { if (visible()) accion(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver);
  destroyRef.onDestroy(() => {
    clearInterval(id);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver);
  });
}
