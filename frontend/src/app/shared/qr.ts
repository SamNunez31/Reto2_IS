import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/**
 * Código QR (SVG) generado en el navegador a partir de un texto.
 * Es una simulación de demo: el QR contiene el código de reserva, que en recepción se escanearía
 * o se escribiría para registrar la llegada.
 */
@Component({
  selector: 'app-qr',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="qr" [attr.viewBox]="vista()" role="img" [attr.aria-label]="'Código QR de la reserva ' + texto()" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path [attr.d]="ruta()" fill="#14211f" />
    </svg>
  `,
  styles: `.qr { display: block; width: 168px; height: 168px; border: 1px solid var(--c-borde); border-radius: 10px; background: #fff; }`,
})
export class QrComponent {
  readonly texto = input.required<string>();
  private static readonly MARGEN = 3; // "zona silenciosa" alrededor, necesaria para escanear

  private readonly modulos = computed(() => {
    const qr = qrcode(0, 'M');
    qr.addData(this.texto());
    qr.make();
    const n = qr.getModuleCount();
    return { n, oscuro: (f: number, c: number) => qr.isDark(f, c) };
  });

  readonly vista = computed(() => {
    const t = this.modulos().n + QrComponent.MARGEN * 2;
    return `0 0 ${t} ${t}`;
  });

  readonly ruta = computed(() => {
    const { n, oscuro } = this.modulos();
    const m = QrComponent.MARGEN;
    let d = '';
    for (let f = 0; f < n; f++) for (let c = 0; c < n; c++) if (oscuro(f, c)) d += `M${c + m} ${f + m}h1v1h-1z`;
    return d;
  });
}
