import { Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { ObservabilidadService, SnapshotObs } from '../../core/services/observabilidad.service';
import { ConfirmarService } from '../../shared/confirmar';
import { enVivo } from '../../shared/en-vivo';

const NOMBRE_TIPO: Record<string, string> = {
  inicio: 'Inicio', carga: 'Carga', 'error-js': 'Error JS', 'error-angular': 'Error Angular', promesa: 'Promesa rechazada',
  recurso: 'Recurso no cargado', clic: 'Clic', visibilidad: 'Visibilidad', api: 'API', demo: 'Demostración',
};

/**
 * Observabilidad local: pestaña del panel de admin y página pública /observabilidad.
 * Muestra datos de ESTE navegador (no se envían a ningún servidor).
 */
@Component({
  selector: 'app-observabilidad',
  template: `
    <section aria-labelledby="obs-titulo">
      <!-- Como página propia (/observabilidad) es el h1; dentro del panel admin va bajo su h1 "Administración" -->
      @if (pagina()) { <h1 id="obs-titulo">Observabilidad del navegador</h1> } @else { <h2 id="obs-titulo">Observabilidad del navegador</h2> }
      <p class="ayuda">Estos datos son locales de este navegador: se guardan en localStorage y no se envían a ningún servidor. Se actualizan solos.</p>

      <div class="acciones obs-acciones">
        <button class="btn" type="button" (click)="demo()">Generar evento de demostración</button>
        <button class="btn" type="button" (click)="descargar()">Descargar snapshot JSON</button>
        <button class="btn btn-peligro" type="button" (click)="limpiar()">Limpiar almacenamiento</button>
      </div>
      <p class="sr-only" role="status" aria-live="polite">{{ aviso() }}</p>
      @if (aviso()) { <p class="alerta alerta-ok" aria-hidden="true">{{ aviso() }}</p> }

      @if (s(); as s) {
        <div class="kpis obs-kpis">
          <div class="kpi"><div class="valor">{{ s.resumen.errores }}</div><div class="etiqueta">Errores (JS, Angular, promesas, recursos)</div></div>
          <div class="kpi"><div class="valor">{{ s.resumen.clics }}</div><div class="etiqueta">Clics registrados</div></div>
          <div class="kpi"><div class="valor">{{ s.resumen.llamadas_api }}</div><div class="etiqueta">Llamadas al API ({{ s.resumen.errores_api }} con error)</div></div>
          <div class="kpi"><div class="valor">{{ ms(s.resumen.p95_api_ms) }}</div><div class="etiqueta">p95 de latencia del API</div></div>
          <div class="kpi"><div class="valor">{{ ms(s.metricas.carga_ms) }}</div><div class="etiqueta">Tiempo de carga de la página</div></div>
          <div class="kpi"><div class="valor">{{ ms(s.metricas.lcp_ms) }}</div><div class="etiqueta">LCP (pintura más grande)</div></div>
        </div>

        <div class="dos-columnas mt">
          <section class="tarjeta" aria-labelledby="obs-entorno">
            <h3 id="obs-entorno">Entorno</h3>
            <dl class="obs-dl">
              <dt>Ventana</dt><dd>{{ s.entorno.viewport ? s.entorno.viewport.ancho + ' × ' + s.entorno.viewport.alto + ' px (escala ' + s.entorno.viewport.dpr + ')' : 'No disponible' }}</dd>
              <dt>Conexión</dt><dd>{{ s.entorno.conexion ? (s.entorno.conexion.tipo ?? '—') + (s.entorno.conexion.rtt_ms !== null ? ' · RTT ' + s.entorno.conexion.rtt_ms + ' ms' : '') : 'No disponible' }}</dd>
              <dt>Primer byte / DOM listo / FCP</dt><dd>{{ ms(s.metricas.ttfb_ms) }} / {{ ms(s.metricas.dom_listo_ms) }} / {{ ms(s.metricas.fcp_ms) }}</dd>
              <dt>Eventos guardados</dt><dd>{{ s.resumen.eventos }} de {{ s.limite_eventos }} (los más antiguos se descartan)</dd>
            </dl>
          </section>
          <section class="tarjeta" aria-labelledby="obs-soporte">
            <h3 id="obs-soporte">Soporte de APIs</h3>
            <ul class="obs-soporte">
              @for (a of apis(s); track a.nombre) {
                <li [class.si]="a.ok"><span aria-hidden="true">{{ a.ok ? '✓' : '✗' }}</span> {{ a.nombre }} <span class="sr-only">{{ a.ok ? 'disponible' : 'no disponible' }}</span></li>
              }
            </ul>
          </section>
        </div>

        <section class="tarjeta mt" aria-labelledby="obs-eventos">
          <h3 id="obs-eventos">Últimos eventos <small>({{ ultimos().length }} más recientes)</small></h3>
          <div class="tabla-scroll">
            <table class="tabla obs-tabla">
              <caption class="sr-only">Últimos eventos registrados en este navegador, del más reciente al más antiguo</caption>
              <thead><tr><th scope="col">Hora</th><th scope="col">Tipo</th><th scope="col">Detalle</th></tr></thead>
              <tbody>
                @for (e of ultimos(); track $index) {
                  <tr [class.fila-error]="esError(e.tipo)">
                    <td class="nowrap">{{ hora(e.t) }}</td>
                    <td class="nowrap">@if (esError(e.tipo)) { <span aria-hidden="true">⚠ </span> }{{ nombre(e.tipo) }}</td>
                    <td class="obs-detalle">{{ e.detalle }}@if (e.tipo === 'api') { · {{ e.datos?.['estado'] }} · {{ e.datos?.['ms'] }} ms }</td>
                  </tr>
                } @empty { <tr><td colspan="3">Aún no hay eventos. Navega por el sitio o genera un evento de demostración.</td></tr> }
              </tbody>
            </table>
          </div>
        </section>
      }
    </section>
  `,
  styles: `
    .mt { margin-top: 1rem; }
    .obs-acciones { flex-wrap: wrap; margin: .5rem 0 1rem; }
    .obs-kpis .valor { font-size: 1.3rem; }
    .obs-dl { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: .3rem .8rem; margin: 0; }
    .obs-dl dt { font-weight: 600; } .obs-dl dd { margin: 0; overflow-wrap: anywhere; }
    .obs-soporte { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: .25rem; }
    .obs-soporte li { color: var(--c-error-texto); } .obs-soporte li.si { color: var(--c-ok-texto); }
    .nowrap { white-space: nowrap; } .obs-detalle { overflow-wrap: anywhere; }
    .fila-error td { background: var(--c-error-fondo); }
    @media (max-width: 560px) {
      .obs-dl { grid-template-columns: minmax(0, 1fr); gap: .1rem; }
      .obs-dl dd { margin-bottom: .4rem; }
      /* Tabla apilada: hora y tipo en una línea, detalle debajo (sin scroll horizontal) */
      .obs-tabla thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .obs-tabla tr { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 .6rem; padding: .4rem 0; border-bottom: 1px solid var(--c-borde-suave); }
      .obs-tabla td { border: 0; padding: 0 .3rem; }
      .obs-tabla td.obs-detalle { grid-column: 1 / -1; }
      .obs-tabla td[colspan] { grid-column: 1 / -1; }
    }
  `,
})
export class ObservabilidadComponent implements OnInit {
  /** true en la ruta /observabilidad (data: { pagina: true }): el título es el h1 de la página. */
  readonly pagina = input(false);
  private readonly obs = inject(ObservabilidadService);
  private readonly confirmar = inject(ConfirmarService);
  private readonly destruir = inject(DestroyRef);
  readonly s = signal<SnapshotObs | null>(null);
  readonly ultimos = signal<SnapshotObs['eventos']>([]);
  readonly aviso = signal('');

  ngOnInit(): void {
    this.actualizar(false);
    enVivo(this.destruir, () => this.actualizar(false), 3000);
  }

  actualizar(avisar: boolean): void {
    const s = this.obs.getSnapshot();
    this.s.set(s);
    this.ultimos.set([...s.eventos].reverse().slice(0, 50));
    if (avisar) this.avisar(`Datos actualizados: ${s.resumen.eventos} eventos.`);
  }

  demo(): void {
    this.obs.demo();
    this.actualizar(false);
    this.avisar('Se generó un evento de demostración.');
  }

  async limpiar(): Promise<void> {
    const si = await this.confirmar.pedir({
      titulo: '¿Limpiar el almacenamiento de observabilidad?',
      mensaje: 'Se borrarán todos los eventos y métricas guardados en este navegador (claves posadaec-observability). No se puede deshacer.',
      confirmar: 'Limpiar almacenamiento',
      tono: 'peligro',
    });
    if (!si) return;
    this.obs.limpiar();
    this.actualizar(false);
    this.avisar('Almacenamiento de observabilidad limpiado.');
  }

  descargar(): void {
    try {
      const blob = new Blob([JSON.stringify(this.obs.getSnapshot(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `posadaec-observability-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.avisar('Snapshot descargado.');
    } catch {
      this.avisar('Este navegador no permitió descargar el archivo.');
    }
  }

  apis(s: SnapshotObs): { nombre: string; ok: boolean }[] {
    return Object.entries(s.entorno.soporte).map(([nombre, ok]) => ({ nombre, ok }));
  }
  /** Milisegundos legibles; "No disponible" si el navegador no da esa métrica (API ausente o aún sin medir). */
  ms(v: number | null): string {
    return v === null || v === undefined ? 'No disponible' : `${v.toLocaleString('es-EC')} ms`;
  }
  hora(t: string): string {
    return new Date(t).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  nombre(tipo: string): string {
    return NOMBRE_TIPO[tipo] ?? tipo;
  }
  esError(tipo: string): boolean {
    return ['error-js', 'error-angular', 'promesa', 'recurso'].includes(tipo);
  }

  private avisar(texto: string): void {
    this.aviso.set('');
    setTimeout(() => this.aviso.set(texto), 50);
  }
}
