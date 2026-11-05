import { CurrencyPipe, DatePipe, JsonPipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { Listado } from '../../core/models/api.models';
import { AdminService, Catalogos, Fila } from '../../core/services/admin.service';
import { DashboardAdminComponent } from './dashboard.component';
import { ObservabilidadComponent } from './observabilidad.component';
import { AnfitrionService, ResenaHost, ReservaHost } from '../../core/services/anfitrion.service';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { avisoTemporal } from '../../shared/aviso';
import { CalificacionComponent } from '../../shared/calificacion';
import { PagoComponent } from '../../shared/pago';
import { fechaMasDias } from '../../shared/fechas';
import { indicePestana } from '../../shared/pestanas';
import { fechaLarga, rangoCorto } from '../../shared/textos';
import { FiltroDirective } from '../../shared/entrada';
import { motivoClave, motivoEmail, motivoNombre, motivoNombreLugar, motivoRango, normalizarEmail, normalizarNombre } from '../../shared/validadores';
import { ConfirmarService } from '../../shared/confirmar';
import { AlertaErrorComponent, CargandoComponent, EstadoComponent } from '../../shared/ui';

type Pestana = 'indicadores' | 'alojamientos' | 'reservas' | 'resenas' | 'usuarios' | 'catalogos' | 'impuestos' | 'eventos' | 'jobs' | 'observabilidad';

/** Panel del ADMIN, operador de Posada EC: catálogo de alojamientos, reservas, reseñas, usuarios y configuración. */
@Component({
  selector: 'app-admin',
  imports: [
    CurrencyPipe, DatePipe, JsonPipe, FormsModule, RouterLink, AlertaErrorComponent, CargandoComponent, EstadoComponent, CalificacionComponent, PagoComponent,
    DashboardAdminComponent, ObservabilidadComponent, FiltroDirective,
  ],
  template: `
    <h1>Administración</h1>
    <div class="pestanas" role="tablist" aria-label="Secciones de administración">
      @for (p of pestanas; track p.id) {
        <button type="button" role="tab" [id]="'tab-admin-' + p.id" [attr.aria-selected]="pestana() === p.id" [attr.tabindex]="pestana() === p.id ? 0 : -1"
                aria-controls="panel-admin" (click)="ir(p.id)" (keydown)="teclaPestana($event)">{{ p.nombre }}</button>
      }
    </div>
    <app-alerta-error [error]="error()" />
    @if (ok.texto()) { <p class="alerta alerta-ok" role="status">{{ ok.texto() }}</p> }
    @if (cargando()) { <app-cargando /> }

    <div id="panel-admin" role="tabpanel" [attr.aria-labelledby]="'tab-admin-' + pestana()">
    @switch (pestana()) {
      @case ('indicadores') { <app-dashboard-admin /> }

      @case ('observabilidad') { <app-observabilidad /> }

      @case ('alojamientos') {
        <div class="barra-acciones d-flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
          <form class="fila filtros-aloj" role="search" (ngSubmit)="ir('alojamientos')">
            <label>Estado
              <select name="fe" [(ngModel)]="filtroAloj" (change)="ir('alojamientos')">
                <option value="">Todos</option><option value="BORRADOR">Borrador</option>
                <option value="PUBLICADO">Publicado</option><option value="SUSPENDIDO">Suspendido</option>
              </select>
            </label>
            <label>Buscar <input name="qa" type="search" [(ngModel)]="busquedaAloj" maxlength="80" placeholder="Nombre, ciudad o código" /></label>
            <button class="btn" type="submit">Buscar</button>
          </form>
          <a class="btn btn-primario" routerLink="/admin/alojamientos/nuevo">+ Nuevo alojamiento</a>
        </div>
        <p class="meta">{{ total() }} alojamiento{{ total() === 1 ? '' : 's' }}</p>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Alojamientos del catálogo</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Ciudad</th><th scope="col">Opciones</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              @for (a of filas(); track a['codigo']) {
                <tr><td>{{ a['codigo'] }}</td><td>{{ a['nombre'] }}</td><td>{{ a['tipo'] }}</td><td>{{ a['ciudad'] }}</td>
                  <td>{{ a['unidades_activas'] }}</td>
                  <td><app-estado [estado]="texto(a['estado'])" /></td>
                  <td class="acciones-fila">
                    <a class="btn btn-chico" [routerLink]="['/admin/alojamientos', a['codigo']]">Editar</a>
                    @if (a['estado'] === 'BORRADOR') { <button class="btn btn-chico btn-primario" type="button" (click)="publicar(a, true)">Publicar</button> }
                    @if (a['estado'] === 'PUBLICADO') {
                      <a class="btn btn-chico" [routerLink]="['/alojamientos', a['codigo']]">Ver anuncio</a>
                      <button class="btn btn-chico" type="button" (click)="publicar(a, false)">Despublicar</button>
                      <button class="btn btn-chico" type="button" (click)="estadoAloj(a, 'SUSPENDIDO')">Suspender</button>
                      <button class="btn btn-chico btn-peligro-borde" type="button" (click)="eliminar(a)" [disabled]="eliminando() === a['codigo']">
                        {{ eliminando() === a['codigo'] ? 'Revisando reservas…' : 'Eliminar' }}</button>
                    }
                    @if (a['estado'] === 'SUSPENDIDO') { <button class="btn btn-chico" type="button" (click)="estadoAloj(a, 'PUBLICADO')">Reactivar</button> }
                  </td></tr>
              } @empty {
                @if (!cargando()) { <tr><td colspan="7">No hay alojamientos con ese filtro.</td></tr> }
              }
            </tbody>
          </table>
        </div>
      }

      @case ('reservas') {
        <label class="filtro-inline">Estado
          <select [(ngModel)]="filtroReservas" (change)="ir('reservas')">
            <option value="">Todas</option><option value="CONFIRMADA">Confirmadas</option><option value="COMPLETADA">Completadas</option>
            <option value="CANCELADA">Canceladas</option>
          </select>
        </label>
        <label class="filtro-inline">Pago
          <select [(ngModel)]="filtroPago" (change)="ir('reservas')">
            <option value="">Todos</option><option value="PENDIENTE">Pago pendiente (efectivo)</option><option value="APROBADO">Pagado</option>
          </select>
        </label>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Reservas</caption>
            <thead><tr><th scope="col">Código de reserva</th><th scope="col">Alojamiento</th><th scope="col">Huésped</th><th scope="col">Fechas</th><th scope="col">Total</th><th scope="col">Estado</th><th scope="col">Pago</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              @for (s of reservas(); track s.id) {
                <tr>
                  <td>{{ s.codigo }}</td><td>{{ s.alojamiento }}</td><td>{{ s.huesped }} ({{ s.num_huespedes }})</td>
                  <td>{{ rango(s.fecha_entrada, s.fecha_salida) }}</td><td>{{ s.total | currency: 'USD' }}</td>
                  <td><app-estado [estado]="s.estado" /></td>
                  <td><app-pago [metodo]="s.metodo_pago" [estado]="s.estado_pago" vista="admin" /></td>
                  <td>
                    @if (s.metodo_pago === 'EFECTIVO' && s.estado_pago === 'PENDIENTE' && (s.estado === 'CONFIRMADA' || s.estado === 'COMPLETADA')) {
                      <button class="btn btn-chico btn-primario" type="button" (click)="confirmarPago(s)">Confirmar pago recibido</button>
                    }
                    @if (s.canal_booking && s.estado === 'CONFIRMADA' && !s.checkin_en) {
                      <button class="btn btn-chico btn-primario" type="button" (click)="registrarLlegada(s)">Registrar llegada</button>
                    } @else if (s.canal_booking && s.checkin_en) {
                      <span class="badge">Huésped en el hotel</span>
                    }
                  </td>
                </tr>
              } @empty { @if (!cargando()) { <tr><td colspan="8">Sin reservas</td></tr> } }
            </tbody>
          </table>
        </div>
      }

      @case ('resenas') {
        <p class="ayuda">Las reseñas las publican solo huéspedes con estadía completada y pasan un control automático de texto. No se moderan a mano; puedes responderlas una vez.</p>
        @for (r of resenas(); track r.id) {
          <article class="tarjeta">
            <p class="resena-cabecera d-flex align-items-center flex-wrap gap-2"><strong>{{ r.autor }}</strong> en {{ r.alojamiento }} <app-calificacion [nota]="r.nota_global" [sinConteo]="true" [chica]="true" />
              <small>{{ fecha(r.created_at) }}</small></p>
            @if (r.comentario) { <p class="texto">{{ r.comentario }}</p> }
            @if (r.respuesta_anfitrion) {
              <p class="respuesta">Respuesta: {{ r.respuesta_anfitrion }}</p>
            } @else {
              <form class="fila" (ngSubmit)="responderResena(r)">
                <label>Responder <input name="r{{ r.id }}" [(ngModel)]="respuestas[r.id]" maxlength="2000" /></label>
                <button class="btn" type="submit" [disabled]="!respuestas[r.id]">Enviar</button>
              </form>
            }
          </article>
        } @empty { @if (!cargando()) { <p>Sin reseñas todavía.</p> } }
      }

      @case ('usuarios') {
        @if (!formUsuario()) {
          <p><button class="btn" type="button" aria-expanded="false" aria-controls="form-usuario" (click)="abrirFormUsuario()">Agregar usuario</button></p>
        } @else {
        <form class="tarjeta" id="form-usuario" (ngSubmit)="crearUsuario()" novalidate>
          <h2>Agregar usuario</h2>
          <p>Se crea activo y con rol de huésped; después puedes hacerlo administrador desde la tabla.</p>
          <div class="fila">
            <label>Correo <input name="ue" type="email" autocomplete="off" maxlength="160" [(ngModel)]="nuevoUsuario.email"
                   [attr.aria-invalid]="!!nuevoUsuario.email && !!problemaUsuario().email" aria-describedby="msg-u-email" /></label>
            <label>Nombres <input name="un" appFiltro="nombre" autocomplete="off" maxlength="80" [(ngModel)]="nuevoUsuario.nombres"
                   [attr.aria-invalid]="!!nuevoUsuario.nombres && !!problemaUsuario().nombres" aria-describedby="msg-u-nombres" /></label>
            <label>Apellidos <input name="ua" appFiltro="nombre" autocomplete="off" maxlength="80" [(ngModel)]="nuevoUsuario.apellidos"
                   [attr.aria-invalid]="!!nuevoUsuario.apellidos && !!problemaUsuario().apellidos" aria-describedby="msg-u-apellidos" /></label>
            <label>Contraseña <input name="up" type="password" autocomplete="new-password" maxlength="72" [(ngModel)]="nuevoUsuario.password"
                   [attr.aria-invalid]="!!nuevoUsuario.password && !!problemaUsuario().password" aria-describedby="msg-u-password" /></label>
          </div>
          @if (nuevoUsuario.email && problemaUsuario().email; as p) { <p class="msg-campo msg-error" id="msg-u-email" role="alert"><span aria-hidden="true">✗</span> Correo: {{ p }}</p> }
          @if (nuevoUsuario.nombres && problemaUsuario().nombres; as p) { <p class="msg-campo msg-error" id="msg-u-nombres" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          @if (nuevoUsuario.apellidos && problemaUsuario().apellidos; as p) { <p class="msg-campo msg-error" id="msg-u-apellidos" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          @if (nuevoUsuario.password && problemaUsuario().password; as p) { <p class="msg-campo msg-error" id="msg-u-password" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          <div class="fila">
            <button class="btn" type="submit" [disabled]="hayProblemaUsuario() || creandoUsuario()">{{ creandoUsuario() ? 'Guardando…' : 'Guardar' }}</button>
            <button class="btn" type="button" [disabled]="creandoUsuario()" (click)="cancelarFormUsuario()">Cancelar</button>
          </div>
        </form>
        }
        <form class="busqueda-barra" role="search" (ngSubmit)="ir('usuarios')"><label>Buscar <input name="q" [(ngModel)]="busqueda" maxlength="80" placeholder="Correo o nombre" /></label><button class="btn" type="submit">Buscar</button></form>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Usuarios</caption>
            <thead><tr><th scope="col">Correo</th><th scope="col">Nombre</th><th scope="col">Rol</th><th scope="col">Activo</th><th scope="col"></th></tr></thead>
            <tbody>
              @for (u of filas(); track u['id']) {
                <tr><td>{{ u['email'] }}</td><td>{{ u['nombres'] }} {{ u['apellidos'] }}</td><td>{{ u['rol'] === 'ADMIN' ? 'Administrador' : 'Huésped' }}</td>
                  <td>{{ u['activo'] ? 'Sí' : 'No' }}</td>
                  <td>@if (u['rol'] !== 'ADMIN') {
                    <button class="btn btn-chico" type="button" (click)="estadoUsuario(u)">{{ u['activo'] ? 'Desactivar' : 'Activar' }}</button>
                    @if (u['activo']) {
                      <button class="btn btn-chico" type="button" (click)="hacerAdmin(u)">Hacer administrador</button>
                    }
                  }</td></tr>
              }
            </tbody>
          </table>
        </div>
      }

      @case ('catalogos') {
        @if (cat(); as k) {
          <div class="dos-columnas">
            <section class="tarjeta">
              <h2>Amenidades ({{ k.amenidades.length }})</h2>
              <ul class="chips d-flex flex-wrap p-0">@for (a of k.amenidades; track a.id) { <li>{{ a.nombre }} <small>· {{ a.categoria }}</small></li> }</ul>
              <form class="fila" (ngSubmit)="crear('amenities', { nombre: nuevaAmenidad, categoria: nuevaCategoria })">
                <label>Nombre <input name="na" [(ngModel)]="nuevaAmenidad" required /></label>
                <label>Categoría <input name="nc" [(ngModel)]="nuevaCategoria" required /></label>
                <button class="btn" type="submit">Agregar</button>
              </form>
            </section>
            <section class="tarjeta">
              <h2>Tipos de alojamiento</h2>
              <ul class="chips d-flex flex-wrap p-0">@for (t of k.tipos; track t.id) { <li>{{ t.nombre }}</li> }</ul>
              <p class="ayuda">Catálogo cerrado: los tipos más buscados en Ecuador.</p>
              <h2>Ciudades ({{ k.ciudades.length }})</h2>
              <form class="fila" (ngSubmit)="crearCiudad()" novalidate>
                <label>Provincia <input name="np" appFiltro="nombre" [(ngModel)]="nuevaProvincia" maxlength="40" placeholder="Pichincha"
                       [attr.aria-invalid]="!!nuevaProvincia && !!problemaCiudad().provincia" aria-describedby="msg-provincia" /></label>
                <label>Ciudad <input name="nci" appFiltro="nombre" [(ngModel)]="nuevaCiudad" maxlength="80" placeholder="Quito"
                       [attr.aria-invalid]="!!nuevaCiudad && !!problemaCiudad().ciudad" aria-describedby="msg-ciudad" /></label>
                <button class="btn" type="submit" [disabled]="!!problemaCiudad().provincia || !!problemaCiudad().ciudad">Agregar ciudad</button>
              </form>
              @if (nuevaProvincia && problemaCiudad().provincia; as p) { <p class="msg-campo msg-error" id="msg-provincia" role="alert"><span aria-hidden="true">✗</span> Provincia: {{ p }}</p> }
              @if (nuevaCiudad && problemaCiudad().ciudad; as p) { <p class="msg-campo msg-error" id="msg-ciudad" role="alert"><span aria-hidden="true">✗</span> Ciudad: {{ p }}</p> }
              <h3>Políticas de cancelación</h3>
              <ul>@for (p of k.politicas; track p.id) { <li><strong>{{ p.nombre }}</strong>: {{ p.descripcion }}</li> }</ul>
            </section>
          </div>
        }
      }

      @case ('impuestos') {
        <section class="tarjeta">
          <h2>Tarifas vigentes e históricas</h2>
          <div class="tabla-scroll">
            <table class="tabla">
              <caption class="sr-only">Tarifas de impuestos y feriados</caption>
              <thead><tr><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">%</th><th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                @for (t of filas(); track t['id']) {
                  <tr><td>{{ t['nombre'] }}</td><td>{{ t['tipo'] }}</td><td>{{ t['porcentaje'] }}</td><td>{{ fecha(t['vigente_desde']) }}</td>
                    <td>{{ t['vigente_hasta'] ? fecha(t['vigente_hasta']) : '—' }}</td>
                    <td>@if (!t['vigente_hasta']) { <button class="btn btn-chico" type="button" (click)="cerrarImpuesto(t)">Cerrar hoy</button> }</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <form class="tarjeta" (ngSubmit)="crearImpuesto()" novalidate>
          <h2>Registrar feriado / tarifa</h2>
          <p class="ayuda">Ejemplo feriado: IVA 8 % del decreto vigente, con sus fechas de inicio y fin; aplica a todos los alojamientos en esas fechas. Verifica el decreto en el SRI.</p>
          <div class="fila">
            <label>Nombre <input name="in" [(ngModel)]="imp.nombre" maxlength="80" placeholder="Feriado de Navidad" (blur)="tocadoImp.nombre = true"
                   [attr.aria-invalid]="tocadoImp.nombre && !!problemaImpuesto().nombre" aria-describedby="msg-imp-nombre" /></label>
            <label>Tipo <select name="it" [(ngModel)]="imp.tipo"><option value="IVA">IVA</option><option value="SERVICIO">Servicio</option></select></label>
            <label>% <input name="ip" appFiltro="decimal" [(ngModel)]="imp.porcentaje" maxlength="6" placeholder="8" (blur)="tocadoImp.porcentaje = true"
                   [attr.aria-invalid]="tocadoImp.porcentaje && !!problemaImpuesto().porcentaje" aria-describedby="msg-imp-pct" /></label>
            <label>Desde <input name="id" type="date" [(ngModel)]="imp.vigente_desde" (blur)="tocadoImp.desde = true"
                   [attr.aria-invalid]="tocadoImp.desde && !!problemaImpuesto().desde" aria-describedby="msg-imp-desde" /></label>
            <label>Hasta <input name="ih" type="date" [(ngModel)]="imp.vigente_hasta" [min]="imp.vigente_desde"
                   [attr.aria-invalid]="!!problemaImpuesto().hasta" aria-describedby="msg-imp-hasta" /></label>
          </div>
          @if (tocadoImp.nombre && problemaImpuesto().nombre; as p) { <p class="msg-campo msg-error" id="msg-imp-nombre" role="alert"><span aria-hidden="true">✗</span> Nombre: {{ p }}</p> }
          @if (tocadoImp.porcentaje && problemaImpuesto().porcentaje; as p) { <p class="msg-campo msg-error" id="msg-imp-pct" role="alert"><span aria-hidden="true">✗</span> Porcentaje: {{ p }}</p> }
          @if (tocadoImp.desde && problemaImpuesto().desde; as p) { <p class="msg-campo msg-error" id="msg-imp-desde" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          @if (problemaImpuesto().hasta; as p) { <p class="msg-campo msg-error" id="msg-imp-hasta" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          <div class="acciones">
            <button class="btn btn-primario" type="submit" [disabled]="impuestoInvalido()">Registrar</button>
            <button class="btn" type="button" (click)="limpiarImpuesto()">Cancelar</button>
          </div>
        </form>
      }

      @case ('eventos') {
        <form class="busqueda-barra" role="search" (ngSubmit)="ir('eventos')"><label>Tipo <input name="te" [(ngModel)]="tipoEvento" placeholder="ReservaCreada" /></label><button class="btn" type="submit">Filtrar</button></form>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Eventos de negocio</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Tipo</th><th scope="col">Correlación</th><th scope="col">Creado</th><th scope="col">Publicado</th><th scope="col">Payload</th></tr></thead>
            <tbody>
              @for (e of filas(); track e['id']) {
                <tr><td>{{ e['id'] }}</td><td>{{ e['tipo'] }}</td><td><code>{{ texto(e['correlacion_id']).slice(0, 8) }}</code></td>
                  <td>{{ texto(e['created_at']) | date: 'short' }}</td><td>{{ e['publicado_en'] ? (texto(e['publicado_en']) | date: 'short') : 'pendiente' }}</td>
                  <td><details><summary>ver</summary><pre>{{ e['payload'] | json }}</pre></details></td></tr>
              }
            </tbody>
          </table>
        </div>
        <nav class="paginacion d-flex justify-content-center align-items-center gap-3">
          <button class="btn" type="button" (click)="paginaEventos(-1)" [disabled]="offset() === 0">Anterior</button>
          <span>{{ offset() + 1 }}–{{ offset() + filas().length }} de {{ total() }}</span>
          <button class="btn" type="button" (click)="paginaEventos(1)" [disabled]="offset() + 20 >= total()">Siguiente</button>
        </nav>
      }

      @case ('jobs') {
        <section class="tarjeta">
          <h2>Ejecutar jobs manualmente</h2>
          <p class="ayuda">Normalmente corren solos (cada 5 min, cada hora, cada 5 s y diario). Usan bloqueo consultivo: si otra instancia los ejecuta, se omiten.</p>
          <div class="acciones">
            @for (j of jobs; track j) { <button class="btn" type="button" (click)="ejecutar(j)">{{ j }}</button> }
          </div>
        </section>
      }
    }
    </div>
  `,
  styles: `.mt { margin-top: 1rem; } .filtro-inline { max-width: 240px; } pre { white-space: pre-wrap; font-size: .8rem; max-width: 420px; }
    .busqueda-barra { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .75rem; margin-bottom: 1rem; }
    .busqueda-barra label { flex: 1 1 260px; max-width: 420px; } .busqueda-barra .btn { flex: 0 0 auto; }
    .filtros-aloj { align-items: flex-end; flex-wrap: wrap; } .acciones-fila { white-space: nowrap; } .acciones-fila .btn { margin: .1rem; }`,
})
export class AdminComponent implements OnInit {
  private readonly api = inject(AdminService);
  /** Rutas /host/* (solo ADMIN): publicar, reservas y reseñas de todo el catálogo. */
  private readonly catalogo = inject(AnfitrionService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly confirmar = inject(ConfirmarService);
  readonly ok = avisoTemporal();
  readonly pestanas: { id: Pestana; nombre: string }[] = [
    { id: 'indicadores', nombre: 'Dashboard' },
    { id: 'alojamientos', nombre: 'Alojamientos' },
    { id: 'reservas', nombre: 'Reservas' },
    { id: 'resenas', nombre: 'Reseñas' },
    { id: 'usuarios', nombre: 'Usuarios' },
    { id: 'catalogos', nombre: 'Catálogos' },
    { id: 'impuestos', nombre: 'Impuestos y feriados' },
    { id: 'eventos', nombre: 'Eventos' },
    { id: 'jobs', nombre: 'Jobs' },
    { id: 'observabilidad', nombre: 'Observabilidad' },
  ];
  readonly jobs = ['completar-estancias', 'publicar-outbox', 'purgar-idempotencia'];
  readonly pestana = signal<Pestana>('indicadores');
  readonly cargando = signal(false);
  /** Código del alojamiento cuyas reservas activas se están revisando antes de eliminarlo. */
  readonly eliminando = signal<unknown>(null);
  readonly error = signal<ErrorVista | null>(null);
  readonly filas = signal<Fila[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly cat = signal<Catalogos | null>(null);
  readonly reservas = signal<ReservaHost[]>([]);
  readonly resenas = signal<ResenaHost[]>([]);
  readonly rango = rangoCorto;
  filtroAloj = '';
  busquedaAloj = '';
  filtroReservas = '';
  filtroPago = '';
  busqueda = '';
  tipoEvento = '';
  respuestas: Record<string, string> = {};
  nuevaAmenidad = '';
  nuevaCategoria = '';
  nuevaProvincia = '';
  nuevaCiudad = '';
  imp = { nombre: '', tipo: 'IVA', porcentaje: 8 as number | null, vigente_desde: '', vigente_hasta: '' };
  tocadoImp = { nombre: false, porcentaje: false, desde: false };
  nuevoUsuario = { email: '', nombres: '', apellidos: '', password: '' };
  /** Evita dobles envíos (doble clic / Enter) mientras el servidor procesa el alta. */
  readonly creandoUsuario = signal(false);
  /** Panel «Agregar usuario» desplegado (oculto por defecto). */
  readonly formUsuario = signal(false);

  ngOnInit(): void {
    // ?tab=alojamientos al volver del editor
    const tab = this.ruta.snapshot.queryParamMap.get('tab') as Pestana | null;
    this.ir(tab && this.pestanas.some((p) => p.id === tab) ? tab : 'indicadores');
  }

  fecha(v: unknown): string {
    return v ? fechaLarga(String(v).slice(0, 10)) : '';
  }

  texto(v: unknown): string {
    return v === null || v === undefined ? '' : String(v);
  }

  /** Flechas, Inicio y Fin cambian de pestaña y mueven el foco (patrón de pestañas WAI-ARIA). */
  teclaPestana(ev: KeyboardEvent): void {
    const i = indicePestana(ev.key, this.pestanas.findIndex((p) => p.id === this.pestana()), this.pestanas.length);
    if (i === null) return;
    ev.preventDefault();
    const id = this.pestanas[i].id;
    this.ir(id);
    document.getElementById('tab-admin-' + id)?.focus();
  }

  ir(p: Pestana): void {
    this.pestana.set(p);
    this.error.set(null);
    switch (p) {
      case 'alojamientos':
        this.listar(this.api.alojamientos(this.filtroAloj, this.busquedaAloj.trim(), 100, 0));
        break;
      case 'reservas':
        this.cargar(this.catalogo.reservas(this.filtroReservas, 100, 0, this.filtroPago), (d) => this.reservas.set(d.items));
        break;
      case 'resenas':
        this.cargar(this.catalogo.resenas(), (d) => this.resenas.set(d));
        break;
      case 'usuarios':
        this.listar(this.api.usuarios(this.busqueda, 50, 0));
        break;
      case 'catalogos':
        this.cargar(this.api.catalogos(), (d) => this.cat.set(d));
        break;
      case 'impuestos':
        this.cargar(this.api.impuestos(), (d) => this.filas.set(d));
        break;
      case 'eventos':
        this.listar(this.api.eventos(this.tipoEvento, 20, this.offset()));
        break;
    }
  }

  paginaEventos(d: number): void {
    this.offset.update((o) => Math.max(0, o + d * 20));
    this.ir('eventos');
  }

  async publicar(a: Fila, publicar: boolean): Promise<void> {
    const nombre = this.texto(a['nombre']);
    const si = await this.confirmar.pedir(
      publicar
        ? { titulo: '¿Publicar este alojamiento?', mensaje: `«${nombre}» aparecerá en las búsquedas y los huéspedes podrán reservarlo al instante.`, confirmar: 'Publicar' }
        : { titulo: '¿Despublicar este alojamiento?', mensaje: `«${nombre}» volverá a borrador y dejará de aparecer en las búsquedas; las reservas existentes no se cancelan.`, confirmar: 'Despublicar', tono: 'peligro' },
    );
    if (!si) return;
    this.accion(this.catalogo.publicar(Number(a['codigo']), publicar), publicar ? `«${nombre}» ya está publicado` : `«${nombre}» volvió a borrador`, 'alojamientos');
  }

  async confirmarPago(s: ReservaHost): Promise<void> {
    const si = await this.confirmar.pedir({
      titulo: '¿Confirmar el pago en efectivo?',
      mensaje: `Confirma solo si ya recibiste ${this.usd(s.total)} en efectivo de ${s.huesped} por la reserva ${s.codigo} («${s.alojamiento}»). Quedará como pagada.`,
      confirmar: 'Sí, lo recibí',
      cancelar: 'Todavía no',
    });
    if (!si) return;
    this.accion(this.catalogo.confirmarPago(s.id), `Pago de la reserva ${s.codigo} confirmado`, 'reservas');
  }

  async registrarLlegada(s: ReservaHost): Promise<void> {
    const si = await this.confirmar.pedir({
      titulo: '¿El huésped ya llegó?',
      mensaje: `Confirma solo si ${s.huesped} se presentó en recepción por la reserva ${s.codigo} («${s.alojamiento}»). Se le asignará habitación y se avisará a Booking.`,
      confirmar: 'Sí, registrar llegada',
      cancelar: 'Todavía no',
    });
    if (!si) return;
    this.ok.limpiar();
    this.catalogo.registrarLlegada(s.id).subscribe({
      next: (r) => {
        this.ok.mostrar(
          `Llegada de la reserva ${s.codigo} registrada (habitación ${r.habitacion_asignada}). ` +
            (r.booking_notificado ? 'Booking fue notificado.' : 'Booking se notificará en breve (reintento automático).'),
        );
        this.ir('reservas');
      },
      error: (e) => this.error.set(leerError(e)),
    });
  }

  private usd(n: number): string {
    return `USD ${Number(n).toFixed(2)}`;
  }

  responderResena(r: ResenaHost): void {
    this.accion(this.catalogo.responderResena(r.id, this.respuestas[r.id]), 'Respuesta publicada', 'resenas');
  }

  /**
   * "Eliminar" usa el cambio de estado que ya existe en la API (PATCH .../status -> SUSPENDIDO): el alojamiento
   * sale de las búsquedas y no se puede reservar, pero su historial (reservas, facturas, reseñas) se conserva.
   * Se bloquea si tiene reservas activas (pendientes o confirmadas que aún no terminan).
   */
  async eliminar(a: Fila): Promise<void> {
    const codigo = Number(a['codigo']);
    const nombre = this.texto(a['nombre']);
    this.ok.limpiar();
    this.error.set(null);
    this.eliminando.set(a['codigo']);
    let activas: ReservaHost[];
    try {
      activas = await this.reservasActivas(codigo);
    } catch (e) {
      this.eliminando.set(null);
      this.error.set(leerError(e));
      return;
    }
    this.eliminando.set(null);
    if (activas.length) {
      const codigos = activas.slice(0, 5).map((r) => r.codigo).join(', ') + (activas.length > 5 ? '…' : '');
      this.error.set({
        status: 409, code: 'RESERVAS_ACTIVAS', campos: {},
        mensaje: `No se puede eliminar «${nombre}»: tiene ${activas.length === 1 ? '1 reserva activa' : `${activas.length} reservas activas`} (${codigos}). `
          + 'Espera a que terminen o cancélalas antes de eliminarlo.',
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const si = await this.confirmar.pedir({
      titulo: '¿Eliminar este alojamiento?',
      mensaje: '¿Seguro que quieres eliminar este alojamiento?',
      detalle: `«${nombre}» dejará de aparecer en las búsquedas y no se podrá reservar. Su historial (reservas pasadas, facturas y reseñas) se conserva.`,
      confirmar: 'Eliminar',
      tono: 'peligro',
    });
    if (!si) return;
    this.accion(this.api.estadoAlojamiento(codigo, 'SUSPENDIDO'), `«${nombre}» eliminado del catálogo`, 'alojamientos');
  }

  /** Reservas pendientes o confirmadas del alojamiento cuya salida aún no pasa (recorre todas las páginas). */
  private async reservasActivas(codigo: number): Promise<ReservaHost[]> {
    const hoy = fechaMasDias(0);
    const activas: ReservaHost[] = [];
    for (const estado of ['PENDIENTE', 'CONFIRMADA']) {
      for (let offset = 0; ; offset += 100) {
        const pagina = await firstValueFrom(this.catalogo.reservas(estado, 100, offset));
        activas.push(...pagina.items.filter((r) => Number(r.alojamiento_codigo) === codigo && String(r.fecha_salida).slice(0, 10) >= hoy));
        if (offset + 100 >= pagina.total) break;
      }
    }
    return activas;
  }

  async estadoAloj(a: Fila, estado: 'PUBLICADO' | 'SUSPENDIDO'): Promise<void> {
    const nombre = this.texto(a['nombre']);
    const si = await this.confirmar.pedir(
      estado === 'SUSPENDIDO'
        ? { titulo: '¿Suspender este alojamiento?', mensaje: `«${nombre}» dejará de aparecer en las búsquedas hasta que lo reactives. Las reservas existentes no se cancelan.`, confirmar: 'Suspender', tono: 'peligro' }
        : { titulo: '¿Reactivar este alojamiento?', mensaje: `«${nombre}» volverá a estar publicado y aparecerá en las búsquedas.`, confirmar: 'Reactivar' },
    );
    if (!si) return;
    this.accion(this.api.estadoAlojamiento(Number(a['codigo']), estado), estado === 'SUSPENDIDO' ? `«${nombre}» suspendido` : `«${nombre}» reactivado`, 'alojamientos');
  }

  async estadoUsuario(u: Fila): Promise<void> {
    const quien = `${this.texto(u['nombres'])} ${this.texto(u['apellidos'])} (${this.texto(u['email'])})`;
    const desactivar = !!u['activo'];
    const si = await this.confirmar.pedir(
      desactivar
        ? { titulo: '¿Desactivar este usuario?', mensaje: `${quien} no podrá iniciar sesión ni hacer reservas. Sus reservas y alojamientos actuales no se borran.`, confirmar: 'Desactivar', tono: 'peligro' }
        : { titulo: '¿Activar este usuario?', mensaje: `${quien} podrá volver a iniciar sesión y usar su cuenta.`, confirmar: 'Activar' },
    );
    if (!si) return;
    this.accion(this.api.estadoUsuario(this.texto(u['id']), !u['activo']), desactivar ? 'Usuario desactivado' : 'Usuario activado', 'usuarios');
  }

  /** Mismas reglas que CrearUsuarioDto del backend (que vuelve a validar). */
  problemaUsuario(): { email?: string; nombres?: string; apellidos?: string; password?: string } {
    const u = this.nuevoUsuario;
    return {
      email: motivoEmail(u.email) ?? undefined,
      nombres: motivoNombre(u.nombres, 'nombres') ?? undefined,
      apellidos: motivoNombre(u.apellidos, 'apellidos') ?? undefined,
      password: motivoClave(u.password) ?? undefined,
    };
  }

  abrirFormUsuario(): void {
    this.error.set(null);
    this.formUsuario.set(true);
  }

  cancelarFormUsuario(): void {
    if (this.creandoUsuario()) return;
    this.nuevoUsuario = { email: '', nombres: '', apellidos: '', password: '' };
    this.error.set(null);
    this.formUsuario.set(false);
  }

  hayProblemaUsuario(): boolean {
    const p = this.problemaUsuario();
    return !!(p.email || p.nombres || p.apellidos || p.password);
  }

  crearUsuario(): void {
    if (this.hayProblemaUsuario() || this.creandoUsuario()) return;
    const u = this.nuevoUsuario;
    this.ok.limpiar();
    this.error.set(null);
    this.creandoUsuario.set(true);
    this.api
      .crearUsuario({ email: normalizarEmail(u.email), nombres: normalizarNombre(u.nombres), apellidos: normalizarNombre(u.apellidos), password: u.password })
      .subscribe({
        next: () => {
          this.creandoUsuario.set(false);
          this.ok.mostrar('Usuario creado');
          this.nuevoUsuario = { email: '', nombres: '', apellidos: '', password: '' };
          this.formUsuario.set(false);
          this.ir('usuarios');
        },
        error: (e) => {
          this.creandoUsuario.set(false);
          this.error.set(leerError(e)); // el formulario conserva lo escrito
        },
      });
  }

  async hacerAdmin(u: Fila): Promise<void> {
    const quien = `${this.texto(u['nombres'])} ${this.texto(u['apellidos'])} (${this.texto(u['email'])})`;
    const si = await this.confirmar.pedir({
      titulo: '¿Asignar rol de administrador?',
      mensaje: `${quien} tendrá acceso al panel de administración (usuarios, catálogos, impuestos, jobs) y dejará de poder reservar. Deberá volver a iniciar sesión para que el cambio se aplique.`,
      confirmar: 'Hacer administrador',
      tono: 'peligro',
    });
    if (!si) return;
    this.accion(this.api.asignarAdmin(this.texto(u['id'])), 'Rol de administrador asignado', 'usuarios');
  }

  crear(tipo: 'amenities' | 'cities', cuerpo: object): void {
    this.accion(this.api.crearCatalogo(tipo, cuerpo), 'Catálogo actualizado', 'catalogos');
  }

  /** Mismas reglas que ImpuestoDto del backend (que vuelve a validar). */
  problemaImpuesto(): { nombre?: string; porcentaje?: string; desde?: string; hasta?: string } {
    const n = this.imp.nombre.trim();
    return {
      nombre: !n ? 'escribe un nombre' : n.length < 3 || n.length > 80 ? 'debe tener entre 3 y 80 caracteres' : undefined,
      porcentaje: motivoRango(this.imp.porcentaje, 0, 100, { obligatorio: true, decimales: 2, unidad: '%' }) ?? undefined,
      desde: this.imp.vigente_desde ? undefined : 'Elige la fecha "Desde"',
      hasta: this.imp.vigente_hasta && this.imp.vigente_desde && this.imp.vigente_hasta < this.imp.vigente_desde ? '"Hasta" no puede ser antes de "Desde"' : undefined,
    };
  }
  impuestoInvalido(): boolean {
    return Object.values(this.problemaImpuesto()).some(Boolean);
  }
  limpiarImpuesto(): void {
    this.imp = { nombre: '', tipo: 'IVA', porcentaje: 8, vigente_desde: '', vigente_hasta: '' };
    this.tocadoImp = { nombre: false, porcentaje: false, desde: false };
  }

  crearImpuesto(): void {
    if (this.impuestoInvalido()) {
      this.tocadoImp = { nombre: true, porcentaje: true, desde: true };
      return;
    }
    const { vigente_hasta, ...resto } = { ...this.imp, nombre: this.imp.nombre.trim(), porcentaje: Number(this.imp.porcentaje) };
    this.accion(this.api.crearImpuesto(vigente_hasta ? { ...resto, vigente_hasta } : resto), 'Tarifa registrada', 'impuestos');
  }

  problemaCiudad(): { provincia: string | null; ciudad: string | null } {
    return { provincia: motivoNombreLugar(this.nuevaProvincia, 'la provincia', 3, 40), ciudad: motivoNombreLugar(this.nuevaCiudad, 'la ciudad', 2, 80) };
  }
  crearCiudad(): void {
    const p = this.problemaCiudad();
    if (p.provincia || p.ciudad) return;
    this.crear('cities', { provincia: this.nuevaProvincia.trim(), nombre: this.nuevaCiudad.trim() });
  }

  async cerrarImpuesto(t: Fila): Promise<void> {
    const si = await this.confirmar.pedir({
      titulo: '¿Cerrar la vigencia de esta tarifa?',
      mensaje: `«${this.texto(t['nombre'])}» dejará de aplicarse a partir de mañana. Las tarifas no se reabren: si la necesitas otra vez, registra una nueva.`,
      confirmar: 'Cerrar vigencia',
      tono: 'peligro',
    });
    if (!si) return;
    const hoy = new Date().toISOString().slice(0, 10);
    this.accion(this.api.cerrarImpuesto(Number(t['id']), hoy), 'Vigencia cerrada', 'impuestos');
  }

  ejecutar(job: string): void {
    this.api.ejecutarJob(job).subscribe({
      next: (r) => this.ok.mostrar(r.ejecutado ? `${r.job}: ${r.afectados} registros procesados` : `${r.job}: otra instancia lo está ejecutando`),
      error: (e) => this.error.set(leerError(e)),
    });
  }

  private accion(obs: Observable<unknown>, msg: string, recargar: Pestana): void {
    this.ok.limpiar();
    obs.subscribe({
      next: () => {
        this.ok.mostrar(msg);
        this.ir(recargar);
      },
      error: (e) => this.error.set(leerError(e)),
    });
  }

  private listar(obs: Observable<Listado<Fila>>): void {
    this.cargar(obs, (l) => {
      this.filas.set(l.items);
      this.total.set(l.total);
    });
  }

  private cargar<T>(obs: Observable<T>, ok: (d: T) => void): void {
    this.cargando.set(true);
    this.filas.set([]);
    obs.subscribe({
      next: (d) => {
        ok(d);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(leerError(e));
        this.cargando.set(false);
      },
    });
  }
}
