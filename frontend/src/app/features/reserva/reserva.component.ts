import { CurrencyPipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrderDetail } from '../../core/models/api.models';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { AuthService } from '../../core/services/auth.service';
import { CatalogoService } from '../../core/services/catalogo.service';
import { DatosFactura, ReservasService } from '../../core/services/reservas.service';
import { CampoMensajeComponent, conError } from '../../shared/campo';
import {
  formatearCaducidad, formatearNumero, largoCvv, marcaDe, MENSAJE_RECHAZO, motivoCaducidad, motivoCvv, motivoNumero, motivoTitular,
  NOMBRE_MARCA, referenciaPago, resultadoSimulado, ResultadoPrueba, soloDigitos, TARJETAS_PRUEBA,
} from '../../shared/tarjeta';
import { plural, rangoLargo, textoPersonas, tituloPolitica } from '../../shared/textos';
import { QrComponent } from '../../shared/qr';
import { AlertaErrorComponent, CargandoComponent } from '../../shared/ui';
import { bloquearNoDigitos, FiltroDirective } from '../../shared/entrada';
import { HORA_CHECKIN_DEFECTO, instanteCheckin, lineaCancelacion } from '../../shared/cancelacion';
import { lineasTramos } from '../anfitrion/politicas.service';
import { filtrarDocumento, maxDocumento, motivoDocumento, motivoRazon, normalizarEmail, normalizarNombre, traducirMotivoApi, vEmail, vNombre } from '../../shared/validadores';

const VIGENCIA_MS = 15 * 60 * 1000;
const ESPERA_PAGO_MS = 1500;
type Paso = 'factura' | 'pago' | 'confirmacion';
type MetodoPago = 'TARJETA' | 'EFECTIVO';
type TipoFactura = 'CEDULA' | 'RUC' | 'PASAPORTE' | 'CONSUMIDOR_FINAL';

const err = (m: string | null) => (m ? { mensaje: m } : null);
const tipoDe = (c: AbstractControl): TipoFactura => (c.parent?.get('tipo')?.value ?? 'CEDULA') as TipoFactura;
/** Validadores que dependen del tipo de documento elegido. */
const vNumero: ValidatorFn = (c) => (tipoDe(c) === 'CONSUMIDOR_FINAL' ? null : err(motivoDocumento(tipoDe(c), (c.value ?? '').trim())));
const vPersona = (campo: 'nombres' | 'apellidos'): ValidatorFn => (c) => (['CEDULA', 'PASAPORTE'].includes(tipoDe(c)) ? vNombre(campo)(c) : null);
const vRazon: ValidatorFn = (c) => (tipoDe(c) === 'RUC' ? err(motivoRazon(c.value ?? '')) : null);
const vCorreo: ValidatorFn = (c) => (tipoDe(c) === 'CONSUMIDOR_FINAL' ? null : vEmail()(c));

@Component({
  selector: 'app-reserva',
  imports: [CurrencyPipe, ReactiveFormsModule, RouterLink, AlertaErrorComponent, CargandoComponent, CampoMensajeComponent, FiltroDirective, QrComponent],
  template: `
    @if (sel(); as s) {
      @if (paso() !== 'confirmacion') { <a [routerLink]="['/alojamientos', s.codigo]" class="volver"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Volver al alojamiento</span></a> }
      <h1>{{ paso() === 'confirmacion' ? (metodo() === 'EFECTIVO' ? 'Reserva confirmada' : '¡Pago recibido!') : 'Confirma y paga' }}</h1>
      <ol class="pasos" aria-label="Pasos de la reserva">
        @for (p of pasos; track p.id; let i = $index) {
          <li [class.activo]="paso() === p.id" [attr.aria-current]="paso() === p.id ? 'step' : null">{{ i + 1 }}. {{ p.titulo }}</li>
        }
      </ol>

      <div class="dos-columnas checkout">
        <section class="tarjeta">
          <app-alerta-error [error]="error()" />
          @if (recotizar()) {
            <div class="alerta alerta-aviso" role="alert">
              <p>{{ recotizar() }}</p>
              <button class="btn" type="button" (click)="volverACotizar()">Actualizar precio</button>
            </div>
          }
          @if (preparando()) { <app-cargando texto="Preparando tu reserva…" /> }

          <!-- 1. Datos de facturación -->
          @if (paso() === 'factura' && !preparando()) {
            <form [formGroup]="factura" (ngSubmit)="continuarAPago()" novalidate>
              <h2>Datos para la factura</h2>
              <fieldset class="bloque">
                <legend>¿A nombre de quién emitimos la factura?</legend>
                <div class="opciones-tarjeta tipo-doc" role="radiogroup" aria-label="Tipo de documento">
                  @for (t of tipos; track t.id) {
                    <label class="opcion-tarjeta">
                      <input type="radio" formControlName="tipo" [value]="t.id" />
                      <span class="titulo">{{ t.titulo }}</span>
                      <span class="detalle">{{ t.detalle }}</span>
                    </label>
                  }
                </div>
              </fieldset>

              @if (tipo() !== 'CONSUMIDOR_FINAL') {
                <div class="grupo">
                  <label for="fac-numero">{{ etiquetaNumero() }}</label>
                  <input id="fac-numero" formControlName="numero" autocomplete="off" [attr.inputmode]="tipo() === 'PASAPORTE' ? 'text' : 'numeric'"
                         [maxlength]="maxDoc()" (input)="filtrarNumero($event)" [attr.aria-invalid]="mal(factura.controls.numero)" aria-describedby="msg-fac-numero" />
                  <app-campo-mensaje [control]="factura.controls.numero" id="msg-fac-numero" />
                </div>
                @if (tipo() === 'RUC') {
                  <div class="grupo">
                    <label for="fac-razon">Razón social</label>
                    <input id="fac-razon" appFiltro="razon" formControlName="razon" autocomplete="organization" maxlength="160"
                           [attr.aria-invalid]="mal(factura.controls.razon)" aria-describedby="msg-fac-razon" />
                    <app-campo-mensaje [control]="factura.controls.razon" id="msg-fac-razon" />
                  </div>
                } @else {
                  <div class="fila">
                    <div class="grupo">
                      <label for="fac-nombres">Nombres</label>
                      <input id="fac-nombres" appFiltro="nombre" formControlName="nombres" autocomplete="given-name" maxlength="80"
                             [attr.aria-invalid]="mal(factura.controls.nombres)" aria-describedby="msg-fac-nombres" />
                      <app-campo-mensaje [control]="factura.controls.nombres" id="msg-fac-nombres" />
                    </div>
                    <div class="grupo">
                      <label for="fac-apellidos">Apellidos</label>
                      <input id="fac-apellidos" appFiltro="nombre" formControlName="apellidos" autocomplete="family-name" maxlength="80"
                             [attr.aria-invalid]="mal(factura.controls.apellidos)" aria-describedby="msg-fac-apellidos" />
                      <app-campo-mensaje [control]="factura.controls.apellidos" id="msg-fac-apellidos" />
                    </div>
                  </div>
                }
                <div class="grupo">
                  <label for="fac-correo">Correo para la factura</label>
                  <input id="fac-correo" type="email" formControlName="correo" autocomplete="email" inputmode="email" maxlength="160"
                         [attr.aria-invalid]="mal(factura.controls.correo)" aria-describedby="msg-fac-correo" />
                  <app-campo-mensaje [control]="factura.controls.correo" id="msg-fac-correo" />
                </div>
              } @else {
                <p class="nota">La factura se emitirá a <strong>consumidor final</strong>; no necesitas ingresar más datos.</p>
              }
              <button class="btn btn-primario" type="submit" [disabled]="factura.invalid">Continuar al pago</button>
            </form>
          }

          <!-- 2. Pago: tarjeta de crédito o efectivo -->
          @if (paso() === 'pago') {
            <div class="pago-cabecera d-flex justify-content-between align-items-baseline flex-wrap gap-3">
              <h2>Pago</h2>
              <button type="button" class="btn-enlace" (click)="irAFactura()">Editar datos de la factura</button>
            </div>
            <p class="meta">Factura a nombre de <strong>{{ resumenFactura() }}</strong></p>
            <fieldset class="bloque metodo-pago">
              <legend>¿Cómo quieres pagar?</legend>
              <div class="opciones-tarjeta" role="radiogroup" aria-label="Método de pago">
                <label class="opcion-tarjeta">
                  <input type="radio" name="metodo-pago" value="TARJETA" [checked]="metodo() === 'TARJETA'" (change)="elegirMetodo('TARJETA')" />
                  <span class="icono" aria-hidden="true">💳</span>
                  <span class="titulo">Tarjeta de crédito</span>
                  <span class="detalle">Pagas ahora y la reserva queda pagada.</span>
                </label>
                <label class="opcion-tarjeta">
                  <input type="radio" name="metodo-pago" value="EFECTIVO" [checked]="metodo() === 'EFECTIVO'" (change)="elegirMetodo('EFECTIVO')" />
                  <span class="icono" aria-hidden="true">💵</span>
                  <span class="titulo">Efectivo</span>
                  <span class="detalle">Pagas al llegar al alojamiento.</span>
                </label>
              </div>
            </fieldset>

            @if (metodo() === 'EFECTIVO') {
              <div class="pago-efectivo">
                <p class="alerta alerta-info">Pagarás <strong>{{ total() | currency: 'USD' }}</strong> en efectivo al llegar; tu reserva queda confirmada desde ahora.</p>
                <button class="btn btn-primario btn-pagar" type="button" (click)="confirmarEfectivo()" [disabled]="procesando() || vencido()">
                  {{ procesando() ? 'Confirmando…' : 'Confirmar reserva' }}
                </button>
                <div aria-live="polite">@if (procesando()) { <app-cargando texto="Confirmando tu reserva…" /> }</div>
                @if (vencido()) {
                  <p class="alerta alerta-aviso">El precio garantizado venció. <button class="btn" type="button" (click)="volverACotizar()">Actualizar precio</button></p>
                }
              </div>
            } @else {
            <form [formGroup]="tarjeta" (ngSubmit)="pagar()" novalidate autocomplete="on">

              @if (demo()) {
                <details class="tarjetas-prueba">
                  <summary>Tarjetas de prueba</summary>
                  <ul>
                    @for (t of tarjetasPrueba; track t.numero) {
                      <li><button type="button" class="btn-enlace" (click)="usarPrueba(t.numero)">{{ t.numero }}</button> · {{ t.texto }}</li>
                    }
                  </ul>
                  <p class="ayuda">Cualquier otra tarjeta válida se aprueba. Usa una fecha futura y cualquier código.</p>
                </details>
              }

              <div class="grupo">
                <label for="tj-numero">Número de tarjeta</label>
                <div class="input-marca">
                  <input id="tj-numero" formControlName="numero" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456"
                         [maxlength]="23" (beforeinput)="soloDigitos($event)" (input)="formatoNumero($event)" [attr.aria-invalid]="mal(tarjeta.controls.numero)" aria-describedby="tj-marca msg-tj-numero" />
                  <span id="tj-marca" class="marca-tarjeta" [class.con-marca]="marca() !== 'otra'" aria-live="polite">{{ marca() !== 'otra' ? nombreMarca[marca()] : '' }}</span>
                </div>
                <app-campo-mensaje [control]="tarjeta.controls.numero" id="msg-tj-numero" [mostrarOk]="false" />
              </div>
              <div class="grupo">
                <label for="tj-titular">Nombre del titular</label>
                <input id="tj-titular" appFiltro="nombre" formControlName="titular" autocomplete="cc-name" placeholder="Como aparece en la tarjeta" maxlength="80"
                       [attr.aria-invalid]="mal(tarjeta.controls.titular)" aria-describedby="msg-tj-titular" />
                <app-campo-mensaje [control]="tarjeta.controls.titular" id="msg-tj-titular" [mostrarOk]="false" />
              </div>
              <div class="fila">
                <div class="grupo">
                  <label for="tj-cad">Caducidad (MM/AA)</label>
                  <input id="tj-cad" formControlName="caducidad" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" maxlength="5"
                         (beforeinput)="soloDigitos($event)" (input)="formatoCaducidad($event)" [attr.aria-invalid]="mal(tarjeta.controls.caducidad)" aria-describedby="msg-tj-cad" />
                  <app-campo-mensaje [control]="tarjeta.controls.caducidad" id="msg-tj-cad" [mostrarOk]="false" />
                </div>
                <div class="grupo">
                  <label for="tj-cvv">Código de seguridad</label>
                  <input id="tj-cvv" formControlName="cvv" inputmode="numeric" autocomplete="cc-csc" type="password" [maxlength]="largoCvv()"
                         [placeholder]="largoCvv() === 4 ? '4 dígitos' : '3 dígitos'" (beforeinput)="soloDigitos($event)" (input)="formatoCvv($event)"
                         [attr.aria-invalid]="mal(tarjeta.controls.cvv)" aria-describedby="msg-tj-cvv" />
                  <app-campo-mensaje [control]="tarjeta.controls.cvv" id="msg-tj-cvv" [mostrarOk]="false" />
                </div>
              </div>

              @if (rechazo()) { <p class="alerta alerta-error" role="alert">{{ rechazo() }}</p> }
              <button class="btn btn-primario btn-pagar" type="submit" [disabled]="procesando() || vencido() || tarjeta.invalid">
                {{ procesando() ? 'Procesando pago…' : 'Pagar ' + (total() | currency: 'USD') }}
              </button>
              <p class="pago-seguro"><span aria-hidden="true">🔒</span> Pago seguro</p>
              <div aria-live="polite">@if (procesando()) { <app-cargando texto="Procesando tu pago…" /> }</div>
              @if (vencido()) {
                <p class="alerta alerta-aviso">El precio garantizado venció. <button class="btn" type="button" (click)="volverACotizar()">Actualizar precio</button></p>
              }
            </form>
            }
          }

          <!-- 3. Confirmación -->
          @if (paso() === 'confirmacion') {
            @if (orden(); as o) {
              <div class="confirmacion">
                <p class="confirmacion-icono" aria-hidden="true">✅</p>
                <h2>Reserva confirmada en {{ s.nombreAlojamiento }}</h2>
                <ul class="confirmacion-datos">
                  <li><span aria-hidden="true">📅</span> {{ fechas() }}</li>
                  <li><span aria-hidden="true">👥</span> {{ personas() }}</li>
                  @if (lineaPolitica()) { <li><span aria-hidden="true">↩️</span> {{ lineaPolitica() }}</li> }
                  @if (metodo() === 'EFECTIVO') {
                    <li><span aria-hidden="true">💵</span> Total a pagar en efectivo al llegar: <strong>{{ o.total_price | currency: 'USD' }}</strong></li>
                  } @else {
                    <li><span aria-hidden="true">💳</span> Total pagado con tarjeta: <strong>{{ o.total_price | currency: 'USD' }}</strong></li>
                  }
                </ul>
                @if (metodo() === 'EFECTIVO') {
                  <p class="alerta alerta-aviso" role="status">Pago pendiente: pagarás en efectivo al llegar. Presenta tu código de reserva.</p>
                }
                <div class="codigo-reserva">
                  <span class="etiqueta">Código de reserva</span>
                  <strong class="localizador">{{ o.locator }}</strong>
                  <button type="button" class="btn btn-chico" (click)="copiar(o.locator)">{{ copiado() ? 'Copiado ✓' : 'Copiar' }}</button>
                  <span class="sr-only" aria-live="polite">{{ copiado() ? 'Código copiado' : '' }}</span>
                </div>
                <div class="qr-reserva">
                  <app-qr [texto]="o.locator" />
                  <small>Muestra este QR en recepción al llegar</small>
                </div>
                <div class="acciones">
                  <a class="btn btn-primario" routerLink="/mis-reservas">Ver mis reservas</a>
                  <a class="btn" routerLink="/">Seguir explorando</a>
                </div>
              </div>
            }
          }
        </section>

        <aside class="tarjeta resumen-pago" aria-label="Resumen de la reserva">
          <h2>{{ s.nombreAlojamiento }}</h2>
          <p class="meta">{{ s.producto.name }}</p>
          <p>{{ fechas() }}</p>
          <p>{{ personas() }}</p>
          <dl class="desglose">
            <dt>Hospedaje</dt><dd>{{ s.producto.price.base | currency: 'USD' }}</dd>
            @if (s.producto.price.service_fee) { <dt>Servicio</dt><dd>{{ s.producto.price.service_fee | currency: 'USD' }}</dd> }
            @if (s.producto.price.cleaning_fee) { <dt>Limpieza</dt><dd>{{ s.producto.price.cleaning_fee | currency: 'USD' }}</dd> }
            <dt>IVA</dt><dd>{{ s.producto.price.taxes | currency: 'USD' }}</dd>
            <dt class="total">Total</dt><dd class="total">{{ (total() || s.producto.price.total) | currency: 'USD' }}</dd>
          </dl>
          @if (paso() !== 'confirmacion' && previewId && !vencido()) {
            <p class="garantia"><span aria-hidden="true">🔒</span> Precio garantizado por <strong>{{ minutosRestantes() }}</strong></p>
          }
          <section class="politica-resumen" aria-labelledby="titulo-politica">
            <h3 id="titulo-politica">Cancelación {{ politica(s.producto.cancellation_policy.name).toLowerCase() }}</h3>
            <p class="meta">{{ lineaPolitica() || s.producto.cancellation_policy.description }}</p>
            @if (s.producto.cancellation_policy.rules.length && s.producto.cancellation_policy.name !== 'NO_REEMBOLSABLE') {
              <details>
                <summary>Cómo se calcula</summary>
                <ol class="linea-tiempo">
                  @for (l of lineas(s.producto.cancellation_policy.rules); track l.cuando) {
                    <li [class.verde]="l.pct === 0" [class.ambar]="l.pct > 0 && l.pct < 100" [class.rojo]="l.pct === 100"><strong>{{ l.cuando }}</strong><span>{{ l.efecto }}</span></li>
                  }
                </ol>
                <p class="ayuda">Plazos contados hasta el check-in ({{ horaCheckin() }}, hora de Ecuador). La limpieza y los impuestos no cuentan como penalidad.</p>
              </details>
            }
          </section>
        </aside>
      </div>
    }
  `,
})
export class ReservaComponent implements OnInit {
  private readonly reservas = inject(ReservasService);
  private readonly catalogo = inject(CatalogoService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly raiz = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(FormBuilder);
  readonly sel = this.reservas.seleccion;
  /** Ayuda de tarjetas de prueba solo con ?demo=1 en la URL. */
  readonly demo = signal(inject(ActivatedRoute).snapshot.queryParamMap.get('demo') === '1');

  readonly pasos: { id: Paso; titulo: string }[] = [
    { id: 'factura', titulo: 'Datos de facturación' },
    { id: 'pago', titulo: 'Pago' },
    { id: 'confirmacion', titulo: 'Confirmación' },
  ];
  readonly tipos: { id: TipoFactura; titulo: string; detalle: string }[] = [
    { id: 'CEDULA', titulo: 'Cédula', detalle: 'Persona con cédula ecuatoriana' },
    { id: 'RUC', titulo: 'RUC', detalle: 'Empresa o persona con RUC' },
    { id: 'PASAPORTE', titulo: 'Pasaporte', detalle: 'Visitantes extranjeros' },
    { id: 'CONSUMIDOR_FINAL', titulo: 'Consumidor final', detalle: 'Sin datos adicionales' },
  ];
  readonly tarjetasPrueba = TARJETAS_PRUEBA;
  readonly nombreMarca = NOMBRE_MARCA;
  readonly politica = tituloPolitica;
  readonly lineas = lineasTramos;
  readonly soloDigitos = bloquearNoDigitos;

  readonly paso = signal<Paso>('factura');
  /** Método de pago elegido en el paso de pago. */
  readonly metodo = signal<MetodoPago>('TARJETA');
  readonly preparando = signal(false);
  readonly procesando = signal(false);
  readonly error = signal<ErrorVista | null>(null);
  readonly recotizar = signal('');
  readonly rechazo = signal('');
  readonly orden = signal<OrderDetail | null>(null);
  readonly total = signal(0);
  readonly copiado = signal(false);
  previewId = '';
  private venceEn = 0;
  private readonly ahora = signal(Date.now());
  readonly vencido = computed(() => !!this.previewId && this.paso() !== 'confirmacion' && this.ahora() >= this.venceEn);
  readonly minutosRestantes = computed(() => {
    const ms = Math.max(0, this.venceEn - this.ahora());
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  });

  // Datos de la factura (precarga nombre y correo de la sesión; NUNCA la cédula)
  private readonly usuario = this.auth.usuario();
  readonly factura = this.fb.nonNullable.group({
    tipo: ['CEDULA' as TipoFactura],
    numero: ['', vNumero],
    nombres: [this.usuario?.nombres ?? '', vPersona('nombres')],
    apellidos: [this.usuario?.apellidos ?? '', vPersona('apellidos')],
    razon: ['', vRazon],
    correo: [this.usuario?.email ?? '', vCorreo],
  });
  readonly tipo = signal<TipoFactura>('CEDULA');

  // Tarjeta: solo vive en este formulario; nunca se envía, guarda ni registra
  readonly tarjeta = this.fb.nonNullable.group({
    numero: ['', (c: AbstractControl) => err(motivoNumero(c.value ?? ''))],
    titular: ['', (c: AbstractControl) => err(motivoTitular(c.value ?? ''))],
    caducidad: ['', (c: AbstractControl) => err(motivoCaducidad(c.value ?? ''))],
    cvv: ['', (c: AbstractControl) => err(motivoCvv(c.value ?? '', marcaDe(c.parent?.get('numero')?.value ?? '')))],
  });
  readonly marca = signal(marcaDe(''));
  readonly largoCvv = computed(() => largoCvv(this.marca()));

  readonly fechas = computed(() => {
    const s = this.sel();
    return s ? rangoLargo(s.checkin, s.checkout) : '';
  });
  readonly horaCheckin = computed(() => this.sel()?.horaCheckin || HORA_CHECKIN_DEFECTO);
  /** "Cancelación gratis hasta el 9 nov, 14:00 · …" con las fechas reales de esta estancia. */
  readonly lineaPolitica = computed(() => {
    const s = this.sel();
    if (!s) return '';
    const p = s.producto.cancellation_policy;
    return lineaCancelacion(p.name, p.rules ?? [], instanteCheckin(s.checkin, this.horaCheckin()));
  });
  readonly personas = computed(() => {
    const g = this.sel()?.guests;
    return g ? `${textoPersonas(g.number_of_adults, g.children?.length ?? 0)} · ${plural(g.number_of_rooms, 'habitación', 'habitaciones')}` : '';
  });

  constructor() {
    const t = setInterval(() => this.ahora.set(Date.now()), 1000);
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      clearInterval(t);
      this.limpiarTarjeta();
    });
    this.factura.controls.tipo.valueChanges.subscribe((tipo) => {
      this.tipo.set(tipo);
      const n = this.factura.controls.numero;
      n.setValue(filtrarDocumento(tipo, n.value), { emitEvent: false });
      for (const c of ['numero', 'nombres', 'apellidos', 'razon', 'correo'] as const) this.factura.controls[c].updateValueAndValidity({ emitEvent: false });
    });
    this.tarjeta.controls.numero.valueChanges.subscribe(() => this.tarjeta.controls.cvv.updateValueAndValidity({ emitEvent: false }));
  }

  ngOnInit(): void {
    if (!this.sel()) {
      this.router.navigate(['/']);
      return;
    }
    // Cotización congelada (preview, 15 min) al entrar: mismo endpoint y misma lógica de siempre
    this.previsualizar();
  }

  mal(c: AbstractControl): boolean {
    return conError(c);
  }
  maxDoc(): number {
    return maxDocumento(this.tipo());
  }
  etiquetaNumero(): string {
    return this.tipo() === 'CEDULA' ? 'Número de cédula' : this.tipo() === 'RUC' ? 'Número de RUC' : 'Número de pasaporte';
  }
  resumenFactura(): string {
    const v = this.factura.getRawValue();
    if (v.tipo === 'CONSUMIDOR_FINAL') return 'consumidor final';
    const nombre = v.tipo === 'RUC' ? v.razon.trim() : `${normalizarNombre(v.nombres)} ${normalizarNombre(v.apellidos)}`;
    return `${nombre} (${this.tipos.find((t) => t.id === v.tipo)?.titulo} ${v.numero})`;
  }

  // ---------- Filtros mientras se escribe ----------
  filtrarNumero(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const limpio = filtrarDocumento(this.tipo(), el.value);
    if (limpio !== el.value) this.factura.controls.numero.setValue(limpio);
  }
  formatoNumero(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const f = formatearNumero(el.value);
    this.marca.set(marcaDe(f));
    if (f !== el.value) this.tarjeta.controls.numero.setValue(f);
  }
  formatoCaducidad(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const f = formatearCaducidad(el.value);
    if (f !== el.value) this.tarjeta.controls.caducidad.setValue(f);
  }
  formatoCvv(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const f = soloDigitos(el.value).slice(0, this.largoCvv());
    if (f !== el.value) this.tarjeta.controls.cvv.setValue(f);
  }
  usarPrueba(numero: string): void {
    this.tarjeta.patchValue({ numero, titular: 'TITULAR DE PRUEBA', caducidad: '12/30', cvv: '123' });
    this.marca.set(marcaDe(numero));
  }

  // ---------- Pasos ----------
  continuarAPago(): void {
    this.factura.markAllAsTouched();
    if (this.factura.invalid) {
      this.enfocarError();
      return;
    }
    this.paso.set('pago');
    this.rechazo.set('');
    setTimeout(() => this.raiz.nativeElement.querySelector<HTMLElement>('#tj-numero')?.focus());
  }
  irAFactura(): void {
    this.paso.set('factura');
  }

  previsualizar(): void {
    const s = this.sel();
    if (!s) return;
    this.preparando.set(true);
    this.error.set(null);
    this.recotizar.set('');
    this.reservas.previsualizar(s.codigo, s.producto.id, s.guests).subscribe({
      next: (p) => {
        this.previewId = p.order_preview_id;
        this.total.set(p.total_price);
        this.venceEn = Date.now() + VIGENCIA_MS;
        this.preparando.set(false);
      },
      error: (e) => {
        this.preparando.set(false);
        this.fallo(e);
      },
    });
  }

  elegirMetodo(m: MetodoPago): void {
    this.metodo.set(m);
    this.rechazo.set('');
    this.error.set(null);
  }

  /** Efectivo: sin datos de tarjeta; la reserva queda CONFIRMADA y su pago PENDIENTE hasta que el admin lo reciba. */
  confirmarEfectivo(): void {
    this.procesando.set(true);
    this.error.set(null);
    this.reservas.crear(this.previewId, null, this.datosFactura(), 'CASH').subscribe({
      next: (o) => {
        this.procesando.set(false);
        this.orden.set(o);
        this.paso.set('confirmacion');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (e) => {
        this.procesando.set(false);
        const er = leerError(e);
        if (Object.keys(er.campos).some((k) => k.startsWith('customer_details'))) this.ubicarErroresFactura(er.campos);
        else this.fallo(e);
      },
    });
  }

  /** Valida la tarjeta en el cliente, simula 1,5 s de procesamiento y envía SOLO la referencia PAY-… al backend. */
  async pagar(): Promise<void> {
    this.tarjeta.markAllAsTouched();
    if (this.tarjeta.invalid) {
      this.enfocarError();
      return;
    }
    this.procesando.set(true);
    this.rechazo.set('');
    this.error.set(null);
    const resultado: ResultadoPrueba = resultadoSimulado(this.tarjeta.controls.numero.value);
    await new Promise((r) => setTimeout(r, ESPERA_PAGO_MS));
    this.reservas.crear(this.previewId, referenciaPago(resultado), this.datosFactura()).subscribe({
      next: (o) => {
        this.procesando.set(false);
        this.limpiarTarjeta();
        this.orden.set(o);
        this.paso.set('confirmacion');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (e) => {
        this.procesando.set(false);
        const er = leerError(e);
        if (er.code === 'PAYMENT_NOT_AUTHORIZED') {
          // Se conservan los datos de facturación; solo se borra el código de seguridad
          this.rechazo.set(MENSAJE_RECHAZO[resultado === 'aprobada' ? 'rechazada' : resultado]);
          this.tarjeta.controls.cvv.reset('');
        } else if (Object.keys(er.campos).some((k) => k.startsWith('customer_details'))) {
          this.ubicarErroresFactura(er.campos);
        } else {
          this.fallo(e);
        }
      },
    });
  }

  private datosFactura(): DatosFactura {
    const v = this.factura.getRawValue();
    if (v.tipo === 'CONSUMIDOR_FINAL') return { document_type: 'CONSUMIDOR_FINAL', email: this.usuario?.email };
    const base: DatosFactura = { document_type: v.tipo, document_number: v.numero.trim().toUpperCase(), email: normalizarEmail(v.correo) };
    return v.tipo === 'RUC'
      ? { ...base, business_name: v.razon.trim(), first_name: this.usuario?.nombres, last_name: this.usuario?.apellidos }
      : { ...base, first_name: normalizarNombre(v.nombres), last_name: normalizarNombre(v.apellidos) };
  }

  private ubicarErroresFactura(campos: Record<string, string>): void {
    const mapa: Record<string, 'numero' | 'nombres' | 'apellidos' | 'razon' | 'correo'> = {
      'customer_details.document_number': 'numero', 'customer_details.first_name': 'nombres', 'customer_details.last_name': 'apellidos',
      'customer_details.business_name': 'razon', 'customer_details.email': 'correo',
    };
    for (const [k, motivo] of Object.entries(campos)) {
      const c = mapa[k] ? this.factura.controls[mapa[k]] : null;
      c?.setErrors({ api: traducirMotivoApi(motivo) });
      c?.markAsTouched();
    }
    this.paso.set('factura');
    this.enfocarError();
  }

  /** Borra los datos de la tarjeta del formulario (al terminar o al salir). */
  private limpiarTarjeta(): void {
    this.tarjeta.reset({ numero: '', titular: '', caducidad: '', cvv: '' });
    this.marca.set('otra');
  }

  async copiar(codigo: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(codigo);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 3000);
    } catch {
      this.copiado.set(false);
    }
  }

  /** Ante PRICE_CHANGED / ROOM_NO_LONGER_AVAILABLE se vuelve a pedir disponibilidad para las mismas fechas. */
  volverACotizar(): void {
    const s = this.sel();
    if (!s) return;
    this.preparando.set(true);
    this.error.set(null);
    this.recotizar.set('');
    this.catalogo.disponibilidad(s.codigo, s.checkin, s.checkout, s.guests).subscribe({
      next: (productos) => {
        const mismo = productos.find((p) => p.id === s.producto.id);
        this.preparando.set(false);
        if (!mismo) {
          this.recotizar.set('Esa habitación ya no está disponible. Elige otra opción en el alojamiento.');
          return;
        }
        this.reservas.seleccion.set({ ...s, producto: mismo });
        this.previsualizar();
      },
      error: (e) => {
        this.preparando.set(false);
        this.fallo(e);
      },
    });
  }

  private enfocarError(): void {
    setTimeout(() => {
      const el = this.raiz.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus();
    });
  }

  private fallo(e: unknown): void {
    const er = leerError(e);
    if (er.code === 'PRICE_CHANGED') this.recotizar.set(`El precio cambió o la garantía venció: ${er.mensaje}`);
    else if (er.code === 'ROOM_NO_LONGER_AVAILABLE') this.recotizar.set(`Ya no hay disponibilidad: ${er.mensaje}`);
    else this.error.set(er);
  }
}
