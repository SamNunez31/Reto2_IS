import { CurrencyPipe, DatePipe, JsonPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { enVivo } from '../../shared/en-vivo';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { Listado } from '../../core/models/api.models';
import { AdminService, Catalogos, Fila } from '../../core/services/admin.service';
import { CheckinDialogoComponent, DatosCheckin } from './checkin-dialogo.component';
import { SalidaDialogoComponent } from './salida-dialogo.component';
import { HabitacionesComponent } from './habitaciones.component';
import { DashboardAdminComponent } from './dashboard.component';
import { ObservabilidadComponent } from './observabilidad.component';
import { AnfitrionService, DatosSalida, FilaIngresos, ResenaHost, ReservaHost, SugerenciaHabitacion } from '../../core/services/anfitrion.service';
import { ErrorVista, leerError } from '../../core/services/api-base';
import { avisoTemporal } from '../../shared/aviso';
import { CalificacionComponent } from '../../shared/calificacion';
import { OjoClaveComponent } from '../../shared/campo';
import { PagoComponent } from '../../shared/pago';
import { fechaMasDias } from '../../shared/fechas';
import { indicePestana } from '../../shared/pestanas';
import { fechaLarga, rangoCorto } from '../../shared/textos';
import { FiltroDirective } from '../../shared/entrada';
import { motivoClave, motivoEmail, motivoNombre, motivoNombreLugar, motivoRango, normalizarEmail, normalizarNombre } from '../../shared/validadores';
import { ConfirmarService } from '../../shared/confirmar';
import { ICONOS, iconoTipo } from '../../shared/iconos';
import { AlertaErrorComponent, CargandoComponent, EstadoComponent } from '../../shared/ui';

type VistaRecepcion = 'todas' | 'pendientes' | 'hospedados' | 'completadas' | 'canceladas';

type Pestana = 'indicadores' | 'alojamientos' | 'reservas' | 'habitaciones' | 'ingresos' | 'resenas' | 'usuarios' | 'catalogos' | 'impuestos' | 'eventos' | 'jobs' | 'observabilidad';

/** Panel del ADMIN, operador de Posada EC: catálogo de alojamientos, reservas, reseñas, usuarios y configuración. */
@Component({
  selector: 'app-admin',
  imports: [
    CurrencyPipe, DatePipe, JsonPipe, FormsModule, RouterLink, AlertaErrorComponent, CargandoComponent, EstadoComponent, CalificacionComponent, PagoComponent,
    DashboardAdminComponent, ObservabilidadComponent, FiltroDirective, OjoClaveComponent, CheckinDialogoComponent, SalidaDialogoComponent, HabitacionesComponent,
  ],
  template: `
    <h1>Administración</h1>
    <div class="pestanas" role="tablist" aria-label="Secciones de administración">
      @for (p of pestanas; track p.id) {
        <button type="button" role="tab" [id]="'tab-admin-' + p.id" [attr.aria-selected]="pestana() === p.id" [attr.tabindex]="pestana() === p.id ? 0 : -1"
                aria-controls="panel-admin" (click)="ir(p.id)" (keydown)="teclaPestana($event)">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icono(p.id)" /></svg>
          <span>{{ p.nombre }}</span>
        </button>
      }
    </div>
    <app-alerta-error [error]="error()" />
    @if (ok.texto()) { <p class="alerta alerta-ok" role="status">{{ ok.texto() }}</p> }
    @if (cargando()) { <app-cargando /> }

    <div id="panel-admin" role="tabpanel" [attr.aria-labelledby]="'tab-admin-' + pestana()">
    @switch (pestana()) {
      @case ('indicadores') { <app-dashboard-admin /> }

      @case ('observabilidad') { <app-observabilidad /> }

      @case ('habitaciones') { <app-habitaciones /> }

      @case ('ingresos') {
        <p class="ayuda">
          Desglose por mes de las estancias completadas y las penalidades cobradas: lo que queda para el alojamiento,
          lo que se entrega al Estado (IVA y tasa municipal) y lo cobrado al huésped.
        </p>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Ingresos por mes</caption>
            <thead><tr><th scope="col">Mes</th><th scope="col">Estancias</th><th scope="col">Neto del alojamiento</th><th scope="col">Impuestos</th><th scope="col">Cobrado al huésped</th></tr></thead>
            <tbody>
              @for (f of ingresos(); track f.mes) {
                <tr>
                  <td>{{ mesLargo(f.mes) }}</td><td>{{ f.estancias }}</td>
                  <td>{{ f.ingreso_sin_iva | currency: 'USD' }}</td>
                  <td>{{ f.impuestos | currency: 'USD' }}</td>
                  <td><strong>{{ f.ingreso_bruto | currency: 'USD' }}</strong></td>
                </tr>
              } @empty { @if (!cargando()) { <tr><td colspan="5">Todavía no hay estancias completadas</td></tr> } }
            </tbody>
          </table>
        </div>
      }

      @case ('alojamientos') {
        <div class="barra-admin">
          <form class="buscador-adm" role="search" (ngSubmit)="ir('alojamientos')">
            <span class="buscador-texto">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['buscar']" /></svg>
              <input id="q-aloj" name="qa" type="search" [(ngModel)]="busquedaAloj" maxlength="80" placeholder="Buscar por nombre, ciudad o código" />
              <label class="sr-only" for="q-aloj">Buscar alojamientos</label>
            </span>
            <span class="buscador-sep" aria-hidden="true"></span>
            <label class="buscador-estado" for="estado-aloj">
              <span class="buscador-etiqueta">Estado</span>
              <select id="estado-aloj" name="fe" [(ngModel)]="filtroAloj" (change)="ir('alojamientos')">
                <option value="">Todos</option><option value="PUBLICADO">En el catálogo</option>
                <option value="BORRADOR">Suspendidos</option><option value="SUSPENDIDO">Eliminados</option>
              </select>
            </label>
            <button class="buscador-ir" type="submit" title="Buscar" aria-label="Buscar alojamientos">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['buscar']" /></svg>
            </button>
          </form>
          <a class="btn btn-primario nuevo-aloj" routerLink="/admin/alojamientos/nuevo">
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Nuevo alojamiento
          </a>
        </div>
        <p class="meta">{{ total() }} alojamiento{{ total() === 1 ? '' : 's' }}</p>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Alojamientos del catálogo</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Ciudad</th><th scope="col">Opciones</th><th scope="col">Estado</th><th scope="col" class="th-der">Acciones</th></tr></thead>
            <tbody>
              @for (a of filas(); track a['codigo']) {
                <tr><td class="num">{{ a['codigo'] }}</td>
                  <td class="nombre-celda">{{ a['nombre'] }}</td>
                  <td>
                    <span class="tipo">
                      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconoDeTipo(a['tipo'])" /></svg>
                      {{ a['tipo'] }}
                    </span>
                  </td>
                  <td>{{ a['ciudad'] }}</td>
                  <td>{{ a['unidades_activas'] }}</td>
                  <td><app-estado [estado]="texto(a['estado'])" [nombre]="etiquetaEstado(a['estado'])" /></td>
                  <td class="acciones-fila">
                    <a class="ico-btn" [routerLink]="['/admin/alojamientos', a['codigo']]" title="Editar" aria-label="Editar alojamiento">
                      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['editar']" /></svg>
                    </a>
                    @if (a['estado'] === 'BORRADOR') {
                      <button class="ico-btn ico-ok" type="button" (click)="publicar(a, true)"
                              title="Reactivar: vuelve a verse y a poder reservarse" aria-label="Reactivar alojamiento">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['reactivar']" /></svg>
                      </button>
                    }
                    @if (a['estado'] === 'PUBLICADO') {
                      <a class="ico-btn" [routerLink]="['/alojamientos', a['codigo']]" [state]="{ desde: 'admin' }" title="Ver anuncio" aria-label="Ver anuncio público">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['ver']" /></svg>
                      </a>
                      <button class="ico-btn ico-peligro" type="button" (click)="eliminar(a)" [disabled]="eliminando() === a['codigo']"
                              [title]="eliminando() === a['codigo'] ? 'Revisando reservas…' : 'Eliminar: no se puede deshacer'" aria-label="Eliminar alojamiento">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['eliminar']" /></svg>
                      </button>
                    }
                    @if (a['estado'] === 'SUSPENDIDO') {
                      <button class="ico-btn ico-ok" type="button" (click)="estadoAloj(a, 'PUBLICADO')"
                              title="Reactivar: vuelve a verse y a poder reservarse" aria-label="Reactivar alojamiento">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['reactivar']" /></svg>
                      </button>
                    }
                  </td></tr>
              } @empty {
                @if (!cargando()) { <tr><td colspan="7">No hay alojamientos con ese filtro.</td></tr> }
              }
            </tbody>
          </table>
        </div>
      }

      @case ('reservas') {
        <div class="barra-admin">
          <div class="filtros-res">
            <label class="filtro-campo">Estado
              <select name="fr" [(ngModel)]="filtroReservas" (change)="ir('reservas')">
                <option value="">Todas</option><option value="CONFIRMADA">Confirmadas</option><option value="COMPLETADA">Completadas</option>
                <option value="CANCELADA">Canceladas</option>
              </select>
            </label>
            <label class="filtro-campo">Pago
              <select name="fp" [(ngModel)]="filtroPago" (change)="ir('reservas')">
                <option value="">Todos</option><option value="PENDIENTE">Pago pendiente (efectivo)</option><option value="APROBADO">Pagado</option>
              </select>
            </label>
          </div>
          <p class="en-vivo" role="status" aria-live="off" title="Las reservas y cancelaciones de Booking llegan solas">
            <span class="punto-vivo" aria-hidden="true"></span>
            En vivo<span class="en-vivo-hora">@if (actualizadoA()) { · actualizado {{ actualizadoA() }} }</span>
          </p>
        </div>
        <div class="vistas-recepcion" role="group" aria-label="Vista de recepción">
          @for (v of vistasRecepcion; track v.id) {
            <button type="button" class="chip" [class.chip-activo]="vista() === v.id" [attr.aria-pressed]="vista() === v.id" (click)="vista.set(v.id)">
              {{ v.nombre }} ({{ cuentaVista(v.id) }})
            </button>
          }
        </div>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Reservas</caption>
            <thead><tr><th scope="col">Reserva</th><th scope="col">Alojamiento</th><th scope="col">Huésped</th><th scope="col">Fechas</th><th scope="col" class="th-der">Total</th><th scope="col">Estado</th><th scope="col">Pago</th><th scope="col" class="th-der">Acciones</th></tr></thead>
            <tbody>
              @for (s of reservasVisibles(); track s.id) {
                <tr class="fila-reserva">
                  <td>
                    <span class="cod-reserva">{{ s.codigo }}</span>
                    <small class="canal">{{ s.canal_booking ? 'Booking' : 'Directa' }}</small>
                  </td>
                  <td class="nombre-celda">{{ s.alojamiento }}</td>
                  <td>
                    <strong class="huesped-nombre">{{ s.titular_nombre || s.huesped }}</strong>
                    <small class="doc">{{ s.num_huespedes }} huésped{{ s.num_huespedes === 1 ? '' : 'es' }}</small>
                    @if (s.canal_booking && s.estado !== 'CANCELADA') {
                      @if (s.titular_identificacion) {
                        <small class="doc">{{ tipoDoc(s) }} {{ s.titular_identificacion }}</small>
                      } @else {
                        <small class="sin-doc">⚠ Sin identificación registrada</small>
                      }
                    }
                    @if (s.estado === 'CANCELADA' && (s.cancelada_por || s.motivo_cancelacion)) {
                      <small class="motivo">
                        @if (s.cancelada_por) { Cancelada por: {{ quienCancelo(s) }} }
                        @if (s.motivo_cancelacion) { <em>«{{ s.motivo_cancelacion }}»</em> }
                      </small>
                    }
                  </td>
                  <td class="nowrap">{{ rango(s.fecha_entrada, s.fecha_salida) }}</td>
                  <td class="num-der">{{ s.total | currency: 'USD' }}</td>
                  <td><app-estado [estado]="s.estado" /></td>
                  <td><app-pago [metodo]="s.metodo_pago" [estado]="s.estado_pago" vista="admin" /></td>
                  <td class="acciones-fila">
                    <div class="acciones-col">
                    @if (s.metodo_pago === 'EFECTIVO' && s.estado_pago === 'PENDIENTE' && (s.estado === 'CONFIRMADA' || s.estado === 'COMPLETADA')) {
                      <button class="btn btn-chico btn-primario" type="button" (click)="confirmarPago(s)">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['publicar']" /></svg>Confirmar pago</button>
                    }
                    @if (s.estado === 'CONFIRMADA' && !s.checkin_en) {
                      <button class="btn btn-chico btn-primario" type="button" (click)="registrarLlegada(s)">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['checkin']" /></svg>Check-in</button>
                    } @else if (s.checkin_en && !s.checkout_en) {
                      <span class="badge">{{ s.habitacion_asignada ? 'En ' + s.habitacion_asignada : 'Huésped en el hotel' }}</span>
                      <button class="btn btn-chico btn-primario" type="button" (click)="registrarSalida(s)">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['checkout']" /></svg>Check-out</button>
                    } @else if (s.checkout_en) {
                      <span class="badge">Check-out hecho</span>
                    }
                    @if (s.estado === 'PENDIENTE' && !s.canal_booking) {
                      <button class="btn btn-chico btn-peligro-borde" type="button" (click)="cancelarReserva(s)">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['cancelar']" /></svg>Cancelar</button>
                    }
                    </div>
                  </td>
                </tr>
              } @empty { @if (!cargando()) { <tr><td colspan="8">{{ reservas().length ? 'Ninguna reserva en esta vista' : 'Sin reservas' }}</td></tr> } }
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
        @if (formUsuario()) {
        <form class="tarjeta form-usuario" id="form-usuario" (ngSubmit)="crearUsuario()" novalidate>
          <header class="form-usuario-cab">
            <h2>Agregar usuario</h2>
            <p>Se crea activo y con rol de huésped; después puedes hacerlo administrador desde la tabla.</p>
          </header>
          <div class="form-usuario-grid">
            <label class="campo-ancho">Correo electrónico
              <input name="ue" type="email" autocomplete="off" maxlength="160" placeholder="nombre@correo.com" [(ngModel)]="nuevoUsuario.email"
                     [attr.aria-invalid]="!!nuevoUsuario.email && !!problemaUsuario().email" aria-describedby="msg-u-email" /></label>
            <label>Nombres
              <input name="un" appFiltro="nombre" autocomplete="off" maxlength="80" [(ngModel)]="nuevoUsuario.nombres"
                     [attr.aria-invalid]="!!nuevoUsuario.nombres && !!problemaUsuario().nombres" aria-describedby="msg-u-nombres" /></label>
            <label>Apellidos
              <input name="ua" appFiltro="nombre" autocomplete="off" maxlength="80" [(ngModel)]="nuevoUsuario.apellidos"
                     [attr.aria-invalid]="!!nuevoUsuario.apellidos && !!problemaUsuario().apellidos" aria-describedby="msg-u-apellidos" /></label>
            <div class="campo-ancho">
              <label for="u-pass">Contraseña</label>
              <app-ojo-clave #ojo>
                <input id="u-pass" name="up" [type]="ojo.visible() ? 'text' : 'password'" autocomplete="new-password" maxlength="72" [(ngModel)]="nuevoUsuario.password"
                       [attr.aria-invalid]="!!nuevoUsuario.password && !!problemaUsuario().password" aria-describedby="msg-u-password" />
              </app-ojo-clave>
            </div>
          </div>
          @if (nuevoUsuario.email && problemaUsuario().email; as p) { <p class="msg-campo msg-error" id="msg-u-email" role="alert"><span aria-hidden="true">✗</span> Correo: {{ p }}</p> }
          @if (nuevoUsuario.nombres && problemaUsuario().nombres; as p) { <p class="msg-campo msg-error" id="msg-u-nombres" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          @if (nuevoUsuario.apellidos && problemaUsuario().apellidos; as p) { <p class="msg-campo msg-error" id="msg-u-apellidos" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          @if (nuevoUsuario.password && problemaUsuario().password; as p) { <p class="msg-campo msg-error" id="msg-u-password" role="alert"><span aria-hidden="true">✗</span> {{ p }}</p> }
          <div class="form-usuario-acciones">
            <button class="btn btn-fantasma" type="button" [disabled]="creandoUsuario()" (click)="cancelarFormUsuario()">Cancelar</button>
            <button class="btn btn-primario" type="submit" [disabled]="hayProblemaUsuario() || creandoUsuario()">{{ creandoUsuario() ? 'Guardando…' : 'Guardar usuario' }}</button>
          </div>
        </form>
        }
        <div class="barra-admin">
          <form class="buscador-adm" role="search" (ngSubmit)="ir('usuarios')">
            <span class="buscador-texto">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['buscar']" /></svg>
              <input id="q-usr" name="q" type="search" [(ngModel)]="busqueda" maxlength="80" placeholder="Buscar por correo o nombre" />
              <label class="sr-only" for="q-usr">Buscar usuarios</label>
            </span>
            <button class="buscador-ir" type="submit" title="Buscar" aria-label="Buscar usuarios">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['buscar']" /></svg>
            </button>
          </form>
          @if (!formUsuario()) {
            <button class="btn btn-primario nuevo-aloj" type="button" aria-expanded="false" aria-controls="form-usuario" (click)="abrirFormUsuario()">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['agregarUsuario']" /></svg>Agregar usuario
            </button>
          }
        </div>
        <p class="meta">{{ total() }} usuario{{ total() === 1 ? '' : 's' }}</p>
        <div class="tabla-scroll tarjeta">
          <table class="tabla">
            <caption class="sr-only">Usuarios</caption>
            <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col" class="th-der">Acciones</th></tr></thead>
            <tbody>
              @for (u of filas(); track u['id']) {
                <tr class="fila-usuario" [class.inactivo]="!u['activo']">
                  <td>
                    <div class="usuario-celda">
                      <span class="avatar" [attr.data-tono]="tono(u)" aria-hidden="true">{{ iniciales(u) }}</span>
                      <span class="usuario-datos"><strong>{{ u['nombres'] }} {{ u['apellidos'] }}</strong><small>{{ u['email'] }}</small></span>
                    </div>
                  </td>
                  <td><span class="pildora" [class.pildora-admin]="u['rol'] === 'ADMIN'">{{ u['rol'] === 'ADMIN' ? 'Administrador' : 'Huésped' }}</span></td>
                  <td><span class="estado-punto" [class.on]="!!u['activo']">{{ u['activo'] ? 'Activo' : 'Inactivo' }}</span></td>
                  <td class="acciones-fila">@if (u['rol'] !== 'ADMIN') {
                    @if (u['activo']) {
                      <button class="ico-btn" type="button" (click)="hacerAdmin(u)"
                              title="Hacer administrador: acceso al panel de administración" aria-label="Hacer administrador a este usuario">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['admin']" /></svg>
                      </button>
                      <button class="ico-btn ico-peligro" type="button" (click)="estadoUsuario(u)"
                              title="Desactivar: no podrá iniciar sesión" aria-label="Desactivar usuario">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['desactivar']" /></svg>
                      </button>
                    } @else {
                      <button class="ico-btn ico-ok" type="button" (click)="estadoUsuario(u)"
                              title="Activar: vuelve a poder iniciar sesión" aria-label="Activar usuario">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['reactivar']" /></svg>
                      </button>
                    }
                  }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @case ('catalogos') {
        @if (cat(); as k) {
          <p class="cat-intro">Listas que usan los anfitriones al publicar un alojamiento y los huéspedes al buscar. Lo que agregues aquí aparece de inmediato en esos formularios.</p>
          <div class="cat-grid">
            <section class="tarjeta cat-card cat-ancho" aria-labelledby="cat-amen">
              <header class="cat-cab">
                <span class="cat-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['amenidad']" /></svg></span>
                <div><h2 id="cat-amen">Amenidades <span class="cat-cuenta">{{ k.amenidades.length }}</span></h2>
                  <p class="ayuda">Servicios y comodidades que el anfitrión marca en su alojamiento, agrupados por categoría.</p></div>
              </header>
              @for (g of amenidadesPorCategoria(k.amenidades); track g.categoria) {
                <div class="cat-grupo">
                  <h3>{{ g.categoria }}</h3>
                  <ul class="cat-chips">@for (a of g.items; track a.id) { <li>{{ a.nombre }}</li> }</ul>
                </div>
              }
              <form class="cat-form" (ngSubmit)="agregarAmenidad()" novalidate>
                <h3>Agregar amenidad</h3>
                <div class="cat-form-fila">
                  <label>Nombre
                    <input name="na" [(ngModel)]="nuevaAmenidad" maxlength="60" placeholder="Ej.: Parqueadero techado" autocomplete="off" /></label>
                  @let cats = categoriasFiltradas(k.amenidades);
                  <label for="cat-nc">Categoría
                    <div class="combo">
                      <input id="cat-nc" name="nc" [(ngModel)]="nuevaCategoria" maxlength="40" autocomplete="off" role="combobox"
                             placeholder="Elige una o escribe una nueva" aria-controls="cat-lista" [attr.aria-expanded]="catAbierta()"
                             [attr.aria-activedescendant]="catActiva() >= 0 ? 'cat-op-' + catActiva() : null"
                             (focus)="catAbierta.set(true)" (input)="alEscribirCategoria()"
                             (keydown)="tecladoCategoria($event, cats)" (blur)="cerrarCategoriaLuego()" />
                      <button class="combo-flecha" type="button" tabindex="-1" aria-label="Ver categorías"
                              (mousedown)="$event.preventDefault()" (click)="alternarCategorias()">
                        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                      @if (catAbierta() && cats.length) {
                        <ul id="cat-lista" class="sugerencias" role="listbox" aria-label="Categorías de amenidad">
                          @for (c of cats; track c; let i = $index) {
                            <li [id]="'cat-op-' + i" role="option" [attr.aria-selected]="i === catActiva()" [class.activa]="i === catActiva()"
                                (mousedown)="$event.preventDefault(); elegirCategoria(c)">{{ c }}</li>
                          }
                        </ul>
                      }
                    </div></label>
                  <button class="btn btn-primario" type="submit" [disabled]="!nuevaAmenidad.trim() || !nuevaCategoria.trim()">
                    <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Agregar</button>
                </div>
              </form>
            </section>

            <section class="tarjeta cat-card" aria-labelledby="cat-tipos">
              <header class="cat-cab">
                <span class="cat-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['alojamientos']" /></svg></span>
                <div><h2 id="cat-tipos">Tipos de alojamiento <span class="cat-cuenta">{{ k.tipos.length }}</span></h2>
                  <p class="ayuda">Lista cerrada con los tipos más buscados en Ecuador; no se pueden agregar más.</p></div>
              </header>
              <ul class="cat-chips">@for (t of k.tipos; track t.id) {
                <li><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconoDeTipo(t.nombre)" /></svg>{{ t.nombre }}</li>
              }</ul>
            </section>

            <section class="tarjeta cat-card" aria-labelledby="cat-pol">
              <header class="cat-cab">
                <span class="cat-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['impuestos']" /></svg></span>
                <div><h2 id="cat-pol">Políticas de cancelación <span class="cat-cuenta">{{ k.politicas.length }}</span></h2>
                  <p class="ayuda">Cuánto se devuelve al huésped según cuándo cancele. Cada anfitrión elige una.</p></div>
              </header>
              <ul class="cat-politicas">@for (p of k.politicas; track p.id) {
                <li><strong>{{ nombrePolitica(p.nombre) }}</strong><span>{{ p.descripcion }}</span></li>
              }</ul>
            </section>

            <section class="tarjeta cat-card cat-ancho" aria-labelledby="cat-ciu">
              <header class="cat-cab">
                <span class="cat-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['ciudad']" /></svg></span>
                <div><h2 id="cat-ciu">Ciudades <span class="cat-cuenta">{{ k.ciudades.length }}</span></h2>
                  <p class="ayuda">Destinos disponibles al crear un alojamiento y en el buscador, agrupados por provincia.</p></div>
              </header>
              @for (g of ciudadesPorProvincia(k.ciudades); track g.provincia) {
                <div class="cat-grupo">
                  <h3>{{ g.provincia }}</h3>
                  <ul class="cat-chips">@for (c of g.items; track c.id) { <li>{{ c.nombre }}</li> }</ul>
                </div>
              }
              <form class="cat-form" (ngSubmit)="crearCiudad()" novalidate>
                <h3>Agregar ciudad</h3>
                <div class="cat-form-fila">
                  <label>Provincia
                    <input name="np" appFiltro="nombre" [(ngModel)]="nuevaProvincia" maxlength="40" placeholder="Ej.: Pichincha" autocomplete="off"
                           [attr.aria-invalid]="!!nuevaProvincia && !!problemaCiudad().provincia" aria-describedby="msg-provincia" /></label>
                  <label>Ciudad
                    <input name="nci" appFiltro="nombre" [(ngModel)]="nuevaCiudad" maxlength="80" placeholder="Ej.: Quito" autocomplete="off"
                           [attr.aria-invalid]="!!nuevaCiudad && !!problemaCiudad().ciudad" aria-describedby="msg-ciudad" /></label>
                  <button class="btn btn-primario" type="submit" [disabled]="!nuevaProvincia.trim() || !nuevaCiudad.trim() || !!problemaCiudad().provincia || !!problemaCiudad().ciudad">
                    <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Agregar</button>
                </div>
                @if (nuevaProvincia && problemaCiudad().provincia; as p) { <p class="msg-campo msg-error" id="msg-provincia" role="alert"><span aria-hidden="true">✗</span> Provincia: {{ p }}</p> }
                @if (nuevaCiudad && problemaCiudad().ciudad; as p) { <p class="msg-campo msg-error" id="msg-ciudad" role="alert"><span aria-hidden="true">✗</span> Ciudad: {{ p }}</p> }
              </form>
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
        <form class="busqueda-barra" role="search" (ngSubmit)="ir('eventos')">
          <label class="busqueda-campo"><span class="sr-only">Filtrar por tipo de evento</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input name="te" [(ngModel)]="tipoEvento" placeholder="Tipo de evento, p. ej. ReservaCreada" /></label>
          <button class="btn btn-primario" type="submit">Filtrar</button>
        </form>
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
    <app-salida-dialogo [reserva]="salida()" [enviando]="saliendo() !== null" (confirmar)="confirmarSalida($event)" (cerrar)="cerrarSalida()" />
    <app-checkin-dialogo [reserva]="checkin()" [enviando]="enviandoCheckin()" [esHotel]="esHotel()" [numerada]="numerada()" [libres]="libres()" [sugerencias]="sugerencias()" [alojamientoCodigo]="alojamientoCheckin()" (confirmar)="confirmarCheckin($event)" (cerrar)="cerrarCheckin()" />
  `,
  styles: `.mt { margin-top: 1rem; }
    /* Buscador: un solo control continuo (texto · estado · lupa), como en los portales de reservas */
    .barra-admin { display: flex; align-items: center; justify-content: space-between; gap: 1rem 1.25rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .buscador-adm { display: flex; align-items: center; gap: 0; flex: 1 1 26rem; max-width: 40rem; min-width: 16rem; margin: 0; height: 3rem;
                background: var(--c-superficie, #fff); border: 1px solid var(--gris-300, #ddd); border-radius: 999px; padding: 0 .3rem 0 1.1rem;
                transition: box-shadow .15s ease, border-color .15s ease; }
    .buscador-adm:focus-within { border-color: var(--c-acento); box-shadow: 0 0 0 3px rgb(0 0 0 / .06); }
    .buscador-texto { display: flex; align-items: center; gap: .55rem; flex: 1 1 auto; min-width: 0; color: var(--c-suave, #8a8a82); }
    .buscador-texto input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; height: 2.6rem; padding: 0; font: inherit; color: var(--c-texto); }
    .buscador-texto input:focus { outline: none; box-shadow: none; }
    .buscador-sep { width: 1px; height: 1.6rem; background: var(--gris-300, #e4e2dd); margin: 0 .9rem; flex: none; }
    .buscador-estado { display: flex; flex-direction: row; align-items: center; gap: .5rem; margin: 0; flex: none; }
    .buscador-etiqueta { font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--gris-700); line-height: 1; }
    .buscador-estado select { border: 0; background-color: transparent; height: 2rem; padding: 0 1.4rem 0 0; font: inherit; font-weight: 600; width: auto; min-width: 7rem; }
    .buscador-estado select:focus { outline: none; box-shadow: none; }
    .buscador-ir { flex: none; width: 2.4rem; height: 2.4rem; margin-left: .6rem; border: 0; border-radius: 50%; cursor: pointer;
                   background: var(--c-acento); color: #fff; display: inline-flex; align-items: center; justify-content: center; transition: .15s ease; }
    .buscador-ir:hover { background: var(--c-acento-osc); }
    .buscador-ir .ico { width: 1.15rem; height: 1.15rem; stroke-width: 2.1; margin: 0; }
    .nuevo-aloj { flex: none; height: 3rem; padding: 0 1.3rem; border-radius: 999px; }
    @media (max-width: 680px) {
      .buscador-adm { flex-wrap: wrap; border-radius: var(--radio-l, 1rem); padding: .6rem .8rem; }
      .buscador-texto { flex-basis: 100%; }
      .buscador-sep { display: none; }
      .buscador-estado { flex: 1 1 auto; }
    }
    /* Acciones de cada fila: compactas, con la destructiva separada del resto */
    /* Catálogos: tarjetas por lista, con encabezado, grupos y formulario propio */
    .cat-intro { color: var(--gris-700); margin: 0 0 1rem; max-width: 46rem; }
    .cat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; align-items: start; }
    .cat-grid .cat-card { margin: 0; } .cat-ancho { grid-column: 1 / -1; }
    @media (max-width: 860px) { .cat-grid { grid-template-columns: 1fr; } }
    .cat-cab { display: flex; gap: .8rem; align-items: flex-start; margin-bottom: 1rem; }
    .cat-cab h2 { margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: .5rem; }
    .cat-cab .ayuda { margin: .2rem 0 0; }
    .cat-ico { flex: none; width: 2.5rem; height: 2.5rem; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
               background: var(--c-primario-suave); color: var(--c-primario-osc); }
    .cat-ico .ico { width: 1.25rem; height: 1.25rem; }
    .cat-cuenta { font-size: .75rem; font-weight: 700; padding: .05rem .5rem; border-radius: 999px; background: var(--gris-200, #ece9e3); color: var(--gris-700); }
    .cat-grupo { display: grid; grid-template-columns: 9.5rem 1fr; gap: .4rem 1rem; align-items: start; padding: .65rem 0; border-top: 1px solid var(--c-borde-suave); }
    .cat-grupo h3 { margin: .25rem 0 0; font-size: .8rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--gris-700); }
    @media (max-width: 560px) { .cat-grupo { grid-template-columns: 1fr; } }
    .cat-chips { list-style: none; display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; }
    .cat-chips li { display: inline-flex; align-items: center; gap: .4rem; background: var(--c-primario-suave); color: var(--c-primario-osc);
                    border-radius: 999px; padding: .25rem .8rem; font-size: .88rem; font-weight: 500; }
    .cat-chips li .ico { width: .95rem; height: .95rem; }
    .cat-politicas { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
    .cat-politicas li { display: grid; gap: .15rem; padding: .7rem .9rem; border: 1px solid var(--c-borde-suave); border-left: 4px solid var(--c-primario, #b4521f); border-radius: 10px; }
    .cat-politicas strong { font-size: .95rem; } .cat-politicas span { font-size: .88rem; color: var(--gris-700); }
    .cat-form { margin-top: .4rem; padding: 1rem; border-radius: 12px; background: var(--c-fondo, #f7f4ef); }
    .cat-form h3 { margin: 0 0 .6rem; font-size: .95rem; }
    .cat-form-fila { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: .75rem; align-items: end; }
    .cat-form-fila label { margin: 0; } .cat-form-fila .btn { height: 2.75rem; margin: 0; white-space: nowrap; }
    @media (max-width: 680px) { .cat-form-fila { grid-template-columns: 1fr; } }
    /* Reservas: filtros en línea y tabla legible */
    .filtros-res { display: flex; gap: .9rem; flex-wrap: wrap; align-items: flex-end; }
    .filtro-campo { display: grid; gap: .25rem; margin: 0; font-size: .78rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gris-700); }
    .filtro-campo select { width: auto; min-width: 11rem; height: 2.6rem; border-radius: 999px; padding: 0 2rem 0 1rem; font-size: .92rem; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--c-texto); }
    th.th-der, td.num-der { text-align: right; } .nowrap { white-space: nowrap; }
    .num-der { font-variant-numeric: tabular-nums; font-weight: 600; }
    .fila-reserva td { vertical-align: middle; padding-top: .8rem; padding-bottom: .8rem; }
    .cod-reserva { display: block; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
    .canal { display: inline-block; margin-top: .15rem; font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gris-700); }
    .huesped-nombre { display: block; font-weight: 600; }
    .acciones-col { display: flex; flex-direction: column; align-items: flex-end; gap: .35rem; }
    .acciones-col > * { margin: 0 !important; }
    td.acciones-fila { text-align: right; white-space: nowrap; }
    .acciones-fila > * { vertical-align: middle; margin: 0 0 0 .35rem; }
    .acciones-fila .btn { height: 2rem; padding: 0 .7rem; font-size: .85rem; border-radius: 999px; }
    .fila-usuario.inactivo .usuario-datos, .fila-usuario.inactivo .avatar { opacity: .55; }
    .fila-usuario td { vertical-align: middle; }
    .meta { color: var(--gris-700); margin: 0 0 .6rem; }
    /* Iconos de línea: heredan el color del texto y nunca se deforman */
    .ico { width: 1.05rem; height: 1.05rem; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .pestanas button { display: inline-flex; align-items: center; gap: .45rem; }
    .pestanas button .ico { opacity: .75; }
    .pestanas button[aria-selected='true'] .ico { opacity: 1; }
    .btn .ico { margin-right: .35rem; vertical-align: -.2em; }
    .girando { animation: gira 1s linear infinite; }
    @keyframes gira { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .girando { animation: none; } .punto-vivo::after { animation: none; } }
    /* Acciones de fila: un botón por icono, con el texto en el tooltip */
    .ico-btn { display: inline-flex; align-items: center; justify-content: center; width: 2.1rem; height: 2.1rem; border-radius: 50%;
               border: 1px solid var(--gris-300, #ddd); background: transparent; color: var(--gris-700); cursor: pointer; transition: .15s ease; }
    .ico-btn:hover { background: var(--c-fondo, #f2f1ee); color: var(--c-texto); border-color: var(--c-texto); transform: translateY(-1px); }
    .ico-btn:disabled { opacity: .45; cursor: progress; transform: none; }
    .ico-ok:hover { background: #e7f4ec; color: #1d6b3f; border-color: #1d6b3f; }
    .ico-peligro:hover { background: #fde8e6; color: #8a1c13; border-color: #8a1c13; }
    .tipo { display: inline-flex; align-items: center; gap: .4rem; }
    .tipo .ico { color: var(--c-suave, #8a8a82); }
    .num { font-variant-numeric: tabular-nums; color: var(--gris-700); }
    .nombre-celda { font-weight: 600; }
    .tabla tbody tr { transition: background .15s ease; }
    .tabla tbody tr:hover { background: var(--c-fondo, #faf9f7); }
    .vistas-recepcion { display: flex; gap: .4rem; flex-wrap: wrap; margin: .75rem 0; }
    .chip { border: 1px solid var(--c-borde-suave); background: var(--c-superficie); color: var(--gris-700); border-radius: 999px; padding: .4rem 1rem; cursor: pointer; font: inherit; font-size: .9rem; font-weight: 600;
      transition: background var(--transicion), border-color var(--transicion), color var(--transicion); }
    .chip:hover { border-color: var(--c-primario); color: var(--c-primario); }
    .chip:focus-visible { outline: 2px solid var(--c-primario); outline-offset: 2px; }
    .chip-activo, .chip-activo:hover { background: var(--c-primario); color: #fff; border-color: var(--c-primario); }
    .en-vivo { display: inline-flex; align-items: center; gap: .5rem; margin: 0; padding: .45rem .95rem; border-radius: 999px; background: var(--c-primario-suave); color: var(--c-primario); font-size: .85rem; font-weight: 700; }
    .en-vivo-hora { font-weight: 500; font-variant-numeric: tabular-nums; }
    .punto-vivo { position: relative; width: .55rem; height: .55rem; border-radius: 50%; background: #1f9d55; flex: none; }
    .punto-vivo::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #1f9d55; animation: pulso 1.8s ease-out infinite; }
    @keyframes pulso { from { transform: scale(1); opacity: .6; } to { transform: scale(2.6); opacity: 0; } }
    .doc, .motivo, .sin-doc { display: block; color: var(--gris-700); font-size: .8rem; }
    .sin-doc { color: #8a5200; font-weight: 600; }
    .badge-cancelada { background: #fde8e6; color: #8a1c13; margin-left: .35rem; } .filtro-inline { max-width: 240px; } pre { white-space: pre-wrap; font-size: .8rem; max-width: 420px; }
    .busqueda-barra { display: flex; flex-wrap: wrap; align-items: flex-end; gap: .75rem; margin-bottom: 1rem; }
    .busqueda-barra label { flex: 1 1 260px; max-width: 420px; } .busqueda-barra .btn { flex: 0 0 auto; }
    .filtros-aloj { align-items: flex-end; flex-wrap: wrap; } `,
})
export class AdminComponent implements OnInit {
  private readonly api = inject(AdminService);
  /** Rutas /host/* (solo ADMIN): publicar, reservas y reseñas de todo el catálogo. */
  private readonly catalogo = inject(AnfitrionService);
  private readonly ruta = inject(ActivatedRoute);
  private readonly confirmar = inject(ConfirmarService);
  readonly ok = avisoTemporal();
  /** Reserva cuyo diálogo de check-in está abierto (null = cerrado). */
  readonly checkin = signal<ReservaHost | null>(null);
  readonly enviandoCheckin = signal(false);
  /** Tipos libres esas fechas, por si llegaron más huéspedes de los reservados */
  readonly sugerencias = signal<SugerenciaHabitacion[]>([]);
  readonly esHotel = signal(false);
  readonly numerada = signal(false);
  readonly libres = signal<{ id: string; numero: string }[]>([]);
  readonly alojamientoCheckin = signal<number | null>(null);
  /** Reserva cuyo diálogo de check-out está abierto (null = cerrado) */
  readonly salida = signal<ReservaHost | null>(null);
  readonly saliendo = signal<string | null>(null);
  readonly iconos = ICONOS;
  /** En este panel: BORRADOR es «Suspendido» y SUSPENDIDO es un alojamiento ya eliminado del catálogo. */
  protected etiquetaEstado(e: unknown): string {
    return ({ PUBLICADO: 'En el catálogo', BORRADOR: 'Suspendido', SUSPENDIDO: 'Eliminado' })[String(e ?? '')] ?? String(e ?? '');
  }

  protected iconoDeTipo = (t: unknown): string => iconoTipo(String(t ?? ''));
  protected icono = (id: Pestana): string => ICONOS[id] ?? ICONOS['catalogos'];

  readonly pestanas: { id: Pestana; nombre: string }[] = [
    { id: 'indicadores', nombre: 'Dashboard' },
    { id: 'alojamientos', nombre: 'Alojamientos' },
    { id: 'reservas', nombre: 'Reservas' },
    { id: 'habitaciones', nombre: 'Habitaciones' },
    { id: 'ingresos', nombre: 'Ingresos' },
    { id: 'resenas', nombre: 'Reseñas' },
    { id: 'usuarios', nombre: 'Usuarios' },
    { id: 'catalogos', nombre: 'Catálogos' },
    { id: 'impuestos', nombre: 'Impuestos y feriados' },
    { id: 'eventos', nombre: 'Eventos' },
    { id: 'jobs', nombre: 'Jobs' },
    { id: 'observabilidad', nombre: 'Observabilidad' },
  ];
  readonly jobs = ['completar-estancias', 'publicar-outbox', 'purgar-idempotencia'];
  private readonly destruir = inject(DestroyRef);
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
  readonly ingresos = signal<FilaIngresos[]>([]);
  /** Vista de mostrador: agrupa las reservas por el momento de la estancia, no por el estado interno. */
  readonly vistasRecepcion: { id: VistaRecepcion; nombre: string }[] = [
    { id: 'todas', nombre: 'Todas' },
    { id: 'pendientes', nombre: 'Pendientes de llegada' },
    { id: 'hospedados', nombre: 'Hospedados' },
    { id: 'completadas', nombre: 'Completadas' },
    { id: 'canceladas', nombre: 'Canceladas' },
  ];
  readonly vista = signal<VistaRecepcion>('todas');
  readonly sincronizando = signal(false);
  /** Hora de la última lectura de reservas (indicador «En vivo»). */
  readonly actualizadoA = signal('');
  readonly reservasVisibles = computed(() => this.reservas().filter((s) => this.enVista(s, this.vista())));
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
    // En vivo: las reservas (p. ej. las que llegan desde Booking) aparecen solas, sin botón de actualizar
    enVivo(this.destruir, () => this.refrescarReservas(), 10000);
    // Y el reenvío de avisos pendientes / traída de novedades de Booking también es automático
    enVivo(this.destruir, () => this.sincronizarBooking(), 30000);
  }

  private marcarHora(): void {
    this.actualizadoA.set(new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  /** Relee las reservas en segundo plano (sin spinner ni vaciar la lista); ignora errores transitorios. */
  private refrescarReservas(): void {
    if (this.pestana() !== 'reservas' || this.cargando()) return;
    this.catalogo.reservas(this.filtroReservas, 100, 0, this.filtroPago).subscribe({
      next: (d) => { if (this.pestana() === 'reservas') { this.reservas.set(d.items); this.marcarHora(); } },
      error: () => undefined,
    });
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
        this.cargar(this.catalogo.reservas(this.filtroReservas, 100, 0, this.filtroPago), (d) => { this.reservas.set(d.items); this.marcarHora(); });
        break;
      case 'ingresos':
        this.cargar(this.catalogo.ingresos(), (d) => this.ingresos.set(d));
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

  /** ¿La reserva entra en esta vista de mostrador? */
  private enVista(s: ReservaHost, v: VistaRecepcion): boolean {
    switch (v) {
      case 'todas': return true;
      case 'pendientes': return s.estado === 'CONFIRMADA' && !s.checkin_en;
      case 'hospedados': return !!s.checkin_en && !s.checkout_en && s.estado !== 'CANCELADA';
      case 'completadas': return !!s.checkout_en || s.estado === 'COMPLETADA';
      case 'canceladas': return s.estado === 'CANCELADA';
    }
  }

  cuentaVista(v: VistaRecepcion): number {
    return this.reservas().filter((s) => this.enVista(s, v)).length;
  }

  protected quienCancelo(s: ReservaHost): string {
    return ({ CLIENTE: 'el cliente', HOTEL: 'el alojamiento', ADMIN: 'el administrador', SAGA_ORCHESTRATOR: 'Booking (compensación automática)' })[s.cancelada_por ?? ''] ?? s.cancelada_por ?? '';
  }

  protected tipoDoc(s: ReservaHost): string {
    return ({ CEDULA: 'Cédula', PASAPORTE: 'Pasaporte', RUC: 'RUC' })[s.titular_tipo_documento ?? ''] ?? 'Doc.';
  }

  protected mesLargo(mes: string): string {
    const [a, m] = mes.slice(0, 7).split('-');
    return `${['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m)]} ${a}`;
  }

  /** Sincroniza con Booking en segundo plano (sin botón): reenvía avisos pendientes y, si hubo novedades, relee las reservas. */
  private sincronizarBooking(): void {
    if (this.pestana() !== 'reservas' || this.sincronizando()) return;
    this.sincronizando.set(true);
    this.catalogo.sincronizarBooking().subscribe({
      next: (r) => {
        this.sincronizando.set(false);
        if (r.checkin + r.checkout > 0) this.refrescarReservas();
      },
      error: () => this.sincronizando.set(false),
    });
  }

  paginaEventos(d: number): void {
    this.offset.update((o) => Math.max(0, o + d * 20));
    this.ir('eventos');
  }

  async publicar(a: Fila, publicar: boolean): Promise<void> {
    const nombre = this.texto(a['nombre']);
    const si = await this.confirmar.pedir(
      publicar
        ? { titulo: '¿Reactivar este alojamiento?', mensaje: `«${nombre}» volverá a aparecer en las búsquedas y los huéspedes podrán reservarlo al instante.`, confirmar: 'Reactivar' }
        : { titulo: '¿Suspender este alojamiento?', mensaje: `«${nombre}» dejará de aparecer en las búsquedas y no se podrá reservar. Las reservas que ya existen no se cancelan y puedes reactivarlo cuando quieras.`, confirmar: 'Suspender', tono: 'peligro' },
    );
    if (!si) return;
    this.accion(this.catalogo.publicar(Number(a['codigo']), publicar), publicar ? `«${nombre}» volvió al catálogo` : `«${nombre}» quedó suspendido`, 'alojamientos');
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

  async cancelarReserva(s: ReservaHost): Promise<void> {
    const cobrado = s.estado_pago === 'APROBADO' ? ` Se le reembolsará el 100 % (${this.usd(s.total)}) y se anulará la factura.` : ' No había un pago aprobado, así que no hay nada que reembolsar.';
    const si = await this.confirmar.pedir({
      titulo: '¿Cancelar esta reserva?',
      mensaje: `Vas a cancelar la reserva ${s.codigo} de ${s.huesped} en «${s.alojamiento}».${cobrado} Esta acción no se puede deshacer.`,
      confirmar: 'Sí, cancelar reserva',
      cancelar: 'No, volver',
    });
    if (!si) return;
    this.accion(this.catalogo.cancelarReserva(s.id), `Reserva ${s.codigo} cancelada`, 'reservas');
  }

  /** Abre el diálogo de check-in; en hoteles primero trae las habitaciones libres del tipo reservado. */
  registrarLlegada(s: ReservaHost): void {
    this.error.set(null);
    this.catalogo.datosCheckin(s.id).subscribe({
      next: (r) => {
        this.esHotel.set(r.es_hotel);
        this.numerada.set(r.numerada);
        this.libres.set(r.habitaciones_libres);
        this.sugerencias.set(r.sugerencias);
        this.alojamientoCheckin.set(r.alojamiento_codigo);
        this.checkin.set(r.habitacion_asignada ? { ...s, habitacion_asignada: r.habitacion_asignada } : s);
      },
      error: (e) => this.error.set(leerError(e)),
    });
  }

  cerrarCheckin(): void {
    if (!this.enviandoCheckin()) this.checkin.set(null);
  }

  confirmarCheckin(datos: DatosCheckin): void {
    const s = this.checkin();
    if (!s || this.enviandoCheckin()) return;
    this.ok.limpiar();
    this.enviandoCheckin.set(true);
    this.catalogo.registrarLlegada(s.id, datos).subscribe({
      next: (r) => {
        this.enviandoCheckin.set(false);
        this.checkin.set(null);
        this.ok.mostrar(
          `Llegada de la reserva ${s.codigo} registrada (habitación ${r.habitacion_asignada}). ` +
            (r.huespedes_extra > 0 ? `Llegaron ${r.huespedes_extra} huésped(es) más de los reservados. ` : '') +
            (!s.canal_booking ? '' : r.booking_notificado ? 'Booking fue notificado.' : 'Booking se notificará en breve (reintento automático).'),
        );
        this.ir('reservas');
      },
      error: (e) => {
        this.enviandoCheckin.set(false);
        this.checkin.set(null);
        this.error.set(leerError(e));
      },
    });
  }

  registrarSalida(s: ReservaHost): void {
    this.salida.set(s);
  }

  cerrarSalida(): void {
    if (!this.saliendo()) this.salida.set(null);
  }

  confirmarSalida(datos: DatosSalida): void {
    const s = this.salida();
    if (!s || this.saliendo()) return;
    this.ok.limpiar();
    this.error.set(null);
    this.saliendo.set(s.id);
    this.catalogo.registrarSalida(s.id, datos).subscribe({
      next: (r) => {
        this.saliendo.set(null);
        this.salida.set(null);
        this.ok.mostrar(
          `Check-out de la reserva ${s.codigo} registrado` +
            (r.habitacion_en_preparacion ? `: la habitación ${r.habitacion_en_preparacion} quedó en preparación. ` : '. ') +
            (Number(r.consumos_total) > 0 ? `Consumos extra: ${this.usd(Number(r.consumos_total))}.` : ''),
        );
        this.ir('reservas');
      },
      error: (e) => {
        this.saliendo.set(null);
        this.salida.set(null);
        this.error.set(leerError(e));
      },
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

  /** Iniciales para el avatar de la tabla de usuarios. */
  iniciales(u: Record<string, unknown>): string {
    const n = String(u['nombres'] ?? '').trim()[0] ?? '';
    const a = String(u['apellidos'] ?? '').trim()[0] ?? '';
    return (n + a).toUpperCase() || '?';
  }
  /** Tono (0-4) estable según el correo, para variar el color del avatar. */
  tono(u: Record<string, unknown>): number {
    const e = String(u['email'] ?? '');
    let h = 0;
    for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) % 5;
    return h;
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

  /** Lista desplegable de categorías de amenidad: se filtra con lo que el usuario escribe. */
  readonly catAbierta = signal(false);
  readonly catActiva = signal(-1);

  categoriasFiltradas(l: { id: number; nombre: string; categoria: string }[]): string[] {
    const todas = this.amenidadesPorCategoria(l).map((g) => g.categoria);
    const q = this.nuevaCategoria.trim().toLowerCase();
    return q ? todas.filter((c) => c.toLowerCase().includes(q)) : todas;
  }

  alEscribirCategoria(): void {
    this.catAbierta.set(true);
    this.catActiva.set(-1);
  }

  alternarCategorias(): void {
    this.catAbierta.set(!this.catAbierta());
    this.catActiva.set(-1);
  }

  elegirCategoria(c: string): void {
    this.nuevaCategoria = c;
    this.catAbierta.set(false);
    this.catActiva.set(-1);
  }

  /** El clic en una opción llega después del blur: se cierra con un respiro. */
  cerrarCategoriaLuego(): void {
    setTimeout(() => this.catAbierta.set(false), 120);
  }

  tecladoCategoria(ev: KeyboardEvent, lista: string[]): void {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!this.catAbierta()) {
        this.catAbierta.set(true);
        return;
      }
      const n = lista.length;
      if (!n) return;
      const actual = this.catActiva();
      this.catActiva.set(ev.key === 'ArrowDown' ? (actual + 1) % n : actual <= 0 ? n - 1 : actual - 1);
    } else if (ev.key === 'Enter' && this.catAbierta() && this.catActiva() >= 0) {
      ev.preventDefault();
      this.elegirCategoria(lista[this.catActiva()]);
    } else if (ev.key === 'Escape') {
      this.catAbierta.set(false);
      this.catActiva.set(-1);
    }
  }

  /** Amenidades agrupadas por categoría (orden alfabético) para la lista de Catálogos. */
  amenidadesPorCategoria(l: { id: number; nombre: string; categoria: string }[]): { categoria: string; items: { id: number; nombre: string }[] }[] {
    const m = new Map<string, { id: number; nombre: string }[]>();
    for (const a of l) m.set(a.categoria, [...(m.get(a.categoria) ?? []), { id: a.id, nombre: a.nombre }]);
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], 'es')).map(([categoria, items]) => ({ categoria, items }));
  }

  /** Ciudades agrupadas por provincia. */
  ciudadesPorProvincia(l: { id: number; provincia: string; nombre: string }[]): { provincia: string; items: { id: number; nombre: string }[] }[] {
    const m = new Map<string, { id: number; nombre: string }[]>();
    for (const c of l) m.set(c.provincia, [...(m.get(c.provincia) ?? []), { id: c.id, nombre: c.nombre }]);
    return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], 'es'))
      .map(([provincia, items]) => ({ provincia, items: items.sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) }));
  }

  /** NO_REEMBOLSABLE → «No reembolsable». */
  nombrePolitica(n: string): string {
    const t = n.toLowerCase().replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  agregarAmenidad(): void {
    if (!this.nuevaAmenidad.trim() || !this.nuevaCategoria.trim()) return;
    this.crear('amenities', { nombre: this.nuevaAmenidad.trim(), categoria: this.nuevaCategoria.trim() });
    this.nuevaAmenidad = '';
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
    this.nuevaCiudad = '';
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
