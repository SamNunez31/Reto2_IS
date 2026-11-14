import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, ReactiveFormsModule } from '@angular/forms';
import { CatalogoService } from '../../core/services/catalogo.service';
import { CampoMensajeComponent, conError } from '../../shared/campo';
import { FiltroDirective } from '../../shared/entrada';
import { iconoTipo } from '../../shared/iconos';
import { TelefonoDirective } from '../../shared/telefono.directive';
import { PISTA_TELEFONO } from '../../shared/validadores';
import { esUrlHttps, FormAlojamiento, ICONO_AMENIDAD, L, NOMBRE_POLITICA, reglasTexto, urlsDe } from './alojamiento-form';
import { DireccionMapaComponent } from './direccion-mapa.component';
import { lineasTramos, PoliticasService } from './politicas.service';

const mal = (c: AbstractControl | null) => conError(c);

/** Campo que no se puede editar: valor + candado + por qué. */
@Component({
  selector: 'app-campo-bloqueado',
  template: `
    <div class="campo-bloqueado">
      <span class="etiqueta">{{ etiqueta() }}</span>
      <span class="valor"><span aria-hidden="true">🔒</span> {{ valor() }}</span>
      <small class="ayuda">{{ motivo() }}</small>
    </div>
  `,
})
export class CampoBloqueadoComponent {
  readonly etiqueta = input.required<string>();
  readonly valor = input.required<string>();
  readonly motivo = input.required<string>();
}

/** Tipo de alojamiento como tarjetas. */
@Component({
  selector: 'app-sec-tipo',
  imports: [ReactiveFormsModule, CampoMensajeComponent],
  template: `
    <fieldset class="bloque" [formGroup]="form()">
      <legend>¿Qué tipo de alojamiento es?</legend>
      <div class="opciones-tarjeta" role="radiogroup" aria-label="Tipo de alojamiento" tabindex="-1"
           [attr.aria-invalid]="mal(form().controls.tipo_id)" aria-describedby="msg-tipo">
        @for (t of c()?.accommodation_types ?? []; track t.id) {
          <label class="opcion-tarjeta">
            <input type="radio" formControlName="tipo_id" [value]="t.id" />
            <span class="icono" aria-hidden="true"><svg viewBox="0 0 24 24"><path [attr.d]="icono(t.name)" /></svg></span>
            <span class="titulo">{{ t.name }}</span>
          </label>
        }
      </div>
      <app-campo-mensaje [control]="form().controls.tipo_id" id="msg-tipo" [mostrarOk]="false" />
    </fieldset>
  `,
})
export class SecTipoComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly c = toSignal(inject(CatalogoService).constantes());
  readonly mal = mal;
  icono(n: string): string {
    return iconoTipo(n);
  }
}

/** Ciudad y dirección con mapa. */
@Component({
  selector: 'app-sec-ubicacion',
  imports: [ReactiveFormsModule, CampoMensajeComponent, DireccionMapaComponent],
  template: `
    <div [formGroup]="form()">
      <div class="grupo">
        <label for="ed-ciudad">Ciudad</label>
        <select id="ed-ciudad" formControlName="ciudad_id" [attr.aria-invalid]="mal(form().controls.ciudad_id)" aria-describedby="msg-ciudad">
          <option [ngValue]="null">Seleccione</option>
          @for (ci of c()?.cities ?? []; track ci.id) { <option [ngValue]="ci.id">{{ ci.name }} ({{ ci.province }})</option> }
        </select>
        <app-campo-mensaje [control]="form().controls.ciudad_id" id="msg-ciudad" />
      </div>

      <app-direccion-mapa [direccion]="form().controls.direccion" [latitud]="form().controls.latitud" [longitud]="form().controls.longitud"
                          [ciudad]="etiquetaCiudad()" />
    </div>
  `,
})
export class SecUbicacionComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly c = toSignal(inject(CatalogoService).constantes());
  readonly mal = mal;

  etiquetaCiudad(): string {
    const id = this.form().controls.ciudad_id.value;
    const ci = (this.c()?.cities ?? []).find((x) => x.id === id);
    return ci ? `${ci.name}, ${ci.province}` : '';
  }
}

/** Horarios, estadía, limpieza, contacto, categoría y registros. */
@Component({
  selector: 'app-sec-horarios',
  imports: [ReactiveFormsModule, CampoMensajeComponent, TelefonoDirective, FiltroDirective],
  template: `
    <div [formGroup]="form()">
      <div class="fila">
        <div class="grupo">
          <label for="ed-ci">Check-in desde</label>
          <input id="ed-ci" type="time" formControlName="hora_checkin" [attr.aria-invalid]="mal(form().controls.hora_checkin)" aria-describedby="msg-ci" />
          <app-campo-mensaje [control]="form().controls.hora_checkin" id="msg-ci" [mostrarOk]="false" />
        </div>
        <div class="grupo">
          <label for="ed-co">Check-out hasta</label>
          <input id="ed-co" type="time" formControlName="hora_checkout" [attr.aria-invalid]="mal(form().controls.hora_checkout)" aria-describedby="msg-co" />
          <app-campo-mensaje [control]="form().controls.hora_checkout" id="msg-co" [mostrarOk]="false" />
        </div>
        <div class="grupo">
          <label for="ed-nmin">Noches mínimas</label>
          <input id="ed-nmin" appFiltro="entero" formControlName="noches_min" maxlength="3" placeholder="1" [attr.aria-invalid]="mal(form().controls.noches_min)" aria-describedby="msg-nmin" />
          <app-campo-mensaje [control]="form().controls.noches_min" id="msg-nmin" [mostrarOk]="false" />
        </div>
        <div class="grupo">
          <label for="ed-nmax">Noches máximas</label>
          <input id="ed-nmax" appFiltro="entero" formControlName="noches_max" maxlength="3" placeholder="30" [attr.aria-invalid]="mal(form().controls.noches_max)" aria-describedby="msg-nmax" />
          <app-campo-mensaje [control]="form().controls.noches_max" id="msg-nmax" [mostrarOk]="false" />
        </div>
      </div>
      <div class="fila">
        <div class="grupo">
          <label for="ed-limpieza">Tarifa de limpieza (USD)</label>
          <input id="ed-limpieza" appFiltro="decimal" formControlName="tarifa_limpieza" maxlength="8" placeholder="0,00" [attr.aria-invalid]="mal(form().controls.tarifa_limpieza)" aria-describedby="ayuda-limpieza msg-limpieza" />
          <small id="ayuda-limpieza" class="ayuda">Cargo único por reserva (no por noche) que cubre la limpieza. Se suma al total y el huésped lo ve desglosado. Si no cobras limpieza, déjalo en 0.</small>
          <app-campo-mensaje [control]="form().controls.tarifa_limpieza" id="msg-limpieza" [mostrarOk]="false" />
        </div>
        <div class="grupo">
          <label for="ed-tel">Teléfono de contacto (opcional)</label>
          <input id="ed-tel" appTelefono formControlName="telefono_contacto" placeholder="0991234567" [attr.aria-invalid]="mal(form().controls.telefono_contacto)" aria-describedby="ayuda-tel msg-tel" />
          <small id="ayuda-tel" class="ayuda">{{ pistaTelefono }}</small>
          <app-campo-mensaje [control]="form().controls.telefono_contacto" id="msg-tel" />
        </div>
        <div class="grupo">
          <label for="ed-estrellas">Categoría en estrellas</label>
          <select id="ed-estrellas" formControlName="categoria_estrellas" aria-describedby="ayuda-estrellas">
            <option [ngValue]="null">No aplica</option>
            @for (e of [1, 2, 3, 4, 5]; track e) { <option [ngValue]="e">{{ '★'.repeat(e) }} ({{ e }})</option> }
          </select>
          <small id="ayuda-estrellas" class="ayuda">Solo si el Ministerio de Turismo te categorizó. Con 4 o 5 estrellas se suma el 10 % de servicio.</small>
        </div>
      </div>
    </div>
  `,
})
export class SecHorariosComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly pistaTelefono = PISTA_TELEFONO;
  readonly Lim = L;
  readonly mal = mal;
}

/** Política de cancelación (con sus tramos reales) y reglas de la casa. Toda reserva se confirma al aprobarse el pago. */
@Component({
  selector: 'app-sec-reservas',
  imports: [ReactiveFormsModule, CampoMensajeComponent],
  template: `
    <div [formGroup]="form()">
      <p class="nota">⚡ Las reservas se confirman al instante, en cuanto se aprueba el pago.</p>

      <fieldset class="bloque">
        <legend>Política de cancelación</legend>
        <p class="ayuda">Define cuánto del hospedaje se cobra si el huésped cancela. La limpieza y los impuestos no cuentan como penalidad. Si la cambias, solo aplica a las reservas nuevas.</p>
        <div class="opciones-tarjeta grandes" role="radiogroup" aria-label="Política de cancelación" tabindex="-1"
             [attr.aria-invalid]="mal(form().controls.politica_id)" aria-describedby="msg-politica">
          @for (p of c()?.cancellation_policies ?? []; track p.id) {
            <label class="opcion-tarjeta politica">
              <input type="radio" formControlName="politica_id" [value]="p.id" />
              <span class="icono" aria-hidden="true">{{ politica(p.name).icono }}</span>
              <span class="titulo">{{ politica(p.name).titulo }}</span>
              @if (tramos()?.[p.name]; as t) {
                <ol class="linea-tiempo" aria-label="Penalidad según la anticipación">
                  @for (l of lineas(t); track l.cuando) {
                    <li [class.verde]="l.pct === 0" [class.ambar]="l.pct > 0 && l.pct < 100" [class.rojo]="l.pct === 100">
                      <strong>{{ l.cuando }}</strong><span>{{ l.efecto }}</span>
                    </li>
                  }
                </ol>
              } @else {
                <span class="detalle">{{ p.description }}</span>
              }
            </label>
          }
        </div>
        <app-campo-mensaje [control]="form().controls.politica_id" id="msg-politica" [mostrarOk]="false" />
      </fieldset>

      <fieldset class="bloque">
        <legend>Reglas de la casa</legend>
        <div class="opciones-amenidad">
          <label class="opcion-amenidad" [class.elegida]="form().controls.no_fumar.value"><input type="checkbox" formControlName="no_fumar" /> <span aria-hidden="true">🚭</span> No fumar</label>
          <label class="opcion-amenidad" [class.elegida]="form().controls.no_mascotas.value"><input type="checkbox" formControlName="no_mascotas" /> <span aria-hidden="true">🐾</span> No mascotas</label>
          <label class="opcion-amenidad" [class.elegida]="form().controls.no_fiestas.value"><input type="checkbox" formControlName="no_fiestas" /> <span aria-hidden="true">🎉</span> No fiestas ni eventos</label>
          <label class="opcion-amenidad" [class.elegida]="form().controls.silencio.value"><input type="checkbox" formControlName="silencio" /> <span aria-hidden="true">🤫</span> Horario de silencio</label>
        </div>
        @if (form().controls.silencio.value) {
          <div class="grupo hora-silencio">
            <label for="ed-silencio">Silencio desde las</label>
            <input id="ed-silencio" type="time" formControlName="hora_silencio" [attr.aria-invalid]="mal(form().controls.hora_silencio)" aria-describedby="msg-silencio" />
            <app-campo-mensaje [control]="form().controls.hora_silencio" id="msg-silencio" [mostrarOk]="false" />
          </div>
        }
        <div class="grupo">
          <label for="ed-reglas">Otras reglas (opcional)</label>
          <textarea id="ed-reglas" formControlName="reglas_extra" rows="3" [maxlength]="Lim.reglas - 200" placeholder="Ej.: El check-in después de las 22:00 se coordina por teléfono."
                    [attr.aria-invalid]="mal(form().controls.reglas_extra)" aria-describedby="msg-reglas"></textarea>
          <app-campo-mensaje [control]="form().controls.reglas_extra" id="msg-reglas" [mostrarOk]="false" />
        </div>
        @if (texto()) { <p class="ayuda">Los huéspedes verán: <em>{{ texto() }}</em></p> }
      </fieldset>
    </div>
  `,
})
export class SecReservasComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly c = toSignal(inject(CatalogoService).constantes());
  readonly tramos = toSignal(inject(PoliticasService).tramos());
  readonly Lim = L;
  readonly mal = mal;
  readonly lineas = lineasTramos;
  politica(n: string) {
    return NOMBRE_POLITICA[n] ?? { titulo: n, icono: '📄' };
  }
  texto(): string {
    return reglasTexto(this.form().value);
  }
}

/** Título y descripción con contador. */
@Component({
  selector: 'app-sec-texto',
  imports: [ReactiveFormsModule, CampoMensajeComponent],
  template: `
    <div [formGroup]="form()">
      <div class="grupo">
        <label for="ed-nombre">Título del anuncio</label>
        <input id="ed-nombre" formControlName="nombre" [maxlength]="Lim.nombre.max" placeholder="Ej.: Cabaña con vista al volcán y chimenea"
               [attr.aria-invalid]="mal(form().controls.nombre)" aria-describedby="cont-nombre msg-nombre" />
        <small id="cont-nombre" class="contador" [class.cerca]="largo('nombre') > Lim.nombre.max - 15">{{ largo('nombre') }}/{{ Lim.nombre.max }}</small>
        <app-campo-mensaje [control]="form().controls.nombre" id="msg-nombre" />
      </div>
      <div class="grupo">
        <label for="ed-desc">Descripción</label>
        <textarea id="ed-desc" formControlName="descripcion" rows="7" [maxlength]="Lim.descripcion.max"
                  placeholder="Describe los espacios, el entorno, cómo llegar y qué hace única la estadía."
                  [attr.aria-invalid]="mal(form().controls.descripcion)" aria-describedby="cont-desc msg-desc"></textarea>
        <small id="cont-desc" class="contador">{{ largo('descripcion') }}/{{ Lim.descripcion.max }} · mínimo {{ Lim.descripcion.min }}</small>
        <app-campo-mensaje [control]="form().controls.descripcion" id="msg-desc" />
      </div>
    </div>
  `,
})
export class SecTextoComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly Lim = L;
  readonly mal = mal;
  largo(c: 'nombre' | 'descripcion'): number {
    return (this.form().controls[c].value ?? '').length;
  }
}

/** Amenidades agrupadas por categoría (el valor del control es la lista de ids). */
@Component({
  selector: 'app-sec-amenidades',
  template: `
    @for (g of grupos(); track g.categoria) {
      <fieldset class="bloque">
        <legend>{{ g.categoria }}</legend>
        <div class="opciones-amenidad">
          @for (a of g.items; track a.id) {
            <label class="opcion-amenidad" [class.elegida]="tiene(a.id)">
              <input type="checkbox" [checked]="tiene(a.id)" (change)="alternar(a.id)" />
              <span class="icono" aria-hidden="true">{{ icono(a.name) }}</span> {{ a.name }}
            </label>
          }
        </div>
      </fieldset>
    }
  `,
})
export class SecAmenidadesComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly c = toSignal(inject(CatalogoService).constantes());
  readonly grupos = computed(() => {
    const g = new Map<string, { id: number; name: string }[]>();
    for (const a of this.c()?.facilities ?? []) g.set(a.category, [...(g.get(a.category) ?? []), a]);
    return [...g.entries()].map(([categoria, items]) => ({ categoria, items }));
  });
  tiene(id: number): boolean {
    return (this.form().controls.amenidades.value ?? []).includes(id);
  }
  alternar(id: number): void {
    const c = this.form().controls.amenidades;
    const lista = c.value ?? [];
    c.setValue(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
    c.markAsDirty();
  }
  icono(n: string): string {
    return ICONO_AMENIDAD[n] ?? '✔️';
  }
}

/** Fotos por URL con vista previa. */
@Component({
  selector: 'app-sec-fotos',
  imports: [ReactiveFormsModule, CampoMensajeComponent],
  template: `
    <div class="grupo" [formGroup]="form()">
      <label for="ed-fotos">Enlaces de las fotos (una URL https por línea; la primera es la portada)</label>
      <textarea id="ed-fotos" formControlName="imagenes" rows="4" [attr.aria-invalid]="mal(form().controls.imagenes)" aria-describedby="ayuda-fotos msg-fotos"
                placeholder="https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&q=75"></textarea>
      <small id="ayuda-fotos" class="ayuda">Ejemplo: <code>https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&amp;q=75</code>. Hasta {{ Lim.imagenes }} fotos. Necesitas al menos una para publicar.</small>
      <app-campo-mensaje [control]="form().controls.imagenes" id="msg-fotos" />
    </div>
    @if (fotos().length) {
      <ul class="vista-fotos" aria-label="Vista previa de las fotos">
        @for (u of fotos(); track u + $index; let i = $index) {
          <li>
            @if (esHttps(u) && !rotas().has(u)) {
              <img [src]="u" [alt]="'Foto ' + (i + 1)" loading="lazy" (error)="marcarRota(u)" />
            } @else {
              <div class="foto-rota">{{ esHttps(u) ? 'No se pudo cargar' : 'URL no válida' }}</div>
            }
            @if (i === 0) { <span class="etiqueta-portada">Portada</span> }
          </li>
        }
      </ul>
    }
  `,
})
export class SecFotosComponent {
  readonly form = input.required<FormAlojamiento>();
  readonly Lim = L;
  readonly mal = mal;
  readonly rotas = signal(new Set<string>());
  fotos(): string[] {
    return urlsDe(this.form().controls.imagenes.value ?? '');
  }
  esHttps(u: string): boolean {
    return esUrlHttps(u);
  }
  marcarRota(u: string): void {
    this.rotas.update((s) => new Set(s).add(u));
  }
}
