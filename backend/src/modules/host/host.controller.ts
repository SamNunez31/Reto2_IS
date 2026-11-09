import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { auditar } from '../../common/logging/auditoria';
import { Roles, UsuarioActual, UsuarioToken } from '../../common/auth/decorators';
import { listado, Listado, ok, RespuestaApi } from '../../common/http/respuestas';
import { invalido } from '../../common/problem/problem';
import {
  ActualizarAlojamientoDto, ActualizarUnidadDto, CalendarioDto, CrearAlojamientoDto, FiltroReservasHostDto, RangoFechasDto,
  ResponderResenaDto, UnidadDto,
} from './dto/host.dto';
import { HostService, ReservaHost, RespuestaLlegada, ResumenAlojamiento, UnidadHost } from './host.service';

const uuid = (n: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => invalido(`${n} debe ser un UUID`, [{ name: n, reason: 'formato UUID requerido' }]) });
const entero = (n: string) =>
  new ParseIntPipe({ exceptionFactory: () => invalido(`${n} debe ser un entero`, [{ name: n, reason: 'entero requerido' }]) });

/**
 * Gestión del catálogo (ruta propia, fuera del contrato). Posada EC administra su catálogo:
 * solo el ADMIN entra aquí y opera sobre cualquier alojamiento. El portal de anfitriones externos es evolución futura.
 */
@ApiTags('Catálogo (ADMIN)')
@ApiBearerAuth('bearer')
@Roles('ADMIN')
@Controller('host')
export class HostController {
  constructor(private readonly host: HostService) {}

  @Get('accommodations')
  @ApiOperation({ summary: 'Mis alojamientos' })
  async lista(@UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<ResumenAlojamiento[]>> {
    return ok(await this.host.misAlojamientos(u));
  }

  @Post('accommodations')
  @ApiOperation({ summary: 'Crear alojamiento (queda en BORRADOR)' })
  async crear(@Body() dto: CrearAlojamientoDto, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<{ codigo: number }>> {
    return ok(await this.host.crear(dto, u), 'Alojamiento creado en borrador');
  }

  @Get('accommodations/:codigo')
  @ApiOperation({ summary: 'Detalle editable de mi alojamiento' })
  async obtener(@Param('codigo', entero('codigo')) codigo: number, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<Record<string, unknown>>> {
    return ok(await this.host.obtener(codigo, u));
  }

  @Patch('accommodations/:codigo')
  @ApiOperation({ summary: 'Editar mi alojamiento' })
  async actualizar(
    @Param('codigo', entero('codigo')) codigo: number,
    @Body() dto: ActualizarAlojamientoDto,
    @UsuarioActual() u: UsuarioToken,
  ): Promise<RespuestaApi<Record<string, unknown>>> {
    return ok(await this.host.actualizar(codigo, dto, u), 'Alojamiento actualizado');
  }

  @Post('accommodations/:codigo/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publicar (requiere unidad activa y foto)' })
  async publicar(@Param('codigo', entero('codigo')) codigo: number, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<{ estado: string }>> {
    return ok(await this.host.cambiarPublicacion(codigo, true, u), 'Alojamiento publicado');
  }

  @Post('accommodations/:codigo/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Despublicar (vuelve a BORRADOR)' })
  async despublicar(@Param('codigo', entero('codigo')) codigo: number, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<{ estado: string }>> {
    return ok(await this.host.cambiarPublicacion(codigo, false, u), 'Alojamiento despublicado');
  }

  @Get('accommodations/:codigo/units')
  @ApiOperation({ summary: 'Unidades (habitaciones/tipos) de mi alojamiento' })
  async unidades(@Param('codigo', entero('codigo')) codigo: number, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<UnidadHost[]>> {
    return ok(await this.host.unidades(codigo, u));
  }

  @Post('accommodations/:codigo/units')
  @ApiOperation({ summary: 'Agregar unidad' })
  async crearUnidad(
    @Param('codigo', entero('codigo')) codigo: number,
    @Body() dto: UnidadDto,
    @UsuarioActual() u: UsuarioToken,
  ): Promise<RespuestaApi<UnidadHost>> {
    return ok(await this.host.crearUnidad(codigo, dto, u), 'Unidad creada');
  }

  @Patch('units/:id')
  @ApiOperation({ summary: 'Editar o desactivar una unidad' })
  async actualizarUnidad(@Param('id', uuid('id')) id: string, @Body() dto: ActualizarUnidadDto, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<UnidadHost>> {
    return ok(await this.host.actualizarUnidad(id, dto, u), 'Unidad actualizada');
  }

  @Get('units/:id/calendar')
  @ApiOperation({ summary: 'Calendario de precio y cupo (máx. 93 días)' })
  async calendario(
    @Param('id', uuid('id')) id: string,
    @Query() r: RangoFechasDto,
    @UsuarioActual() u: UsuarioToken,
  ): Promise<RespuestaApi<Record<string, unknown>[]>> {
    return ok(await this.host.calendario(id, r.desde, r.hasta, u));
  }

  @Put('units/:id/calendar')
  @ApiOperation({ summary: 'Guardar precios especiales / cupo por día' })
  async guardarCalendario(@Param('id', uuid('id')) id: string, @Body() dto: CalendarioDto, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<{ dias: number }>> {
    return ok(await this.host.guardarCalendario(id, dto, u), 'Calendario actualizado');
  }

  @Get('orders')
  @ApiOperation({ summary: 'Reservas de los alojamientos del catálogo' })
  async reservas(@Query() f: FiltroReservasHostDto, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<Listado<ReservaHost>>> {
    const r = await this.host.reservas(u, f);
    return listado(r.items, r.total, r.limit, r.offset);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Detalle de una reserva (incluye método y estado del pago)' })
  async reserva(@Param('id', uuid('id')) id: string, @UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<ReservaHost>> {
    return ok(await this.host.reserva(id, u));
  }

  @Post('orders/:id/confirm-payment')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirmar que se recibió el pago en efectivo',
    description: 'Marca como APROBADO el pago PENDIENTE en efectivo de la reserva. Idempotente: si ya estaba confirmado responde 200 ' +
      'con ya_confirmado=true. 409 si la reserva no se paga en efectivo o está cancelada. Queda registrado en la auditoría.',
  })
  @ApiResponse({ status: 409, description: 'La reserva no tiene un pago en efectivo que confirmar' })
  async confirmarPago(
    @Param('id', uuid('id')) id: string,
    @UsuarioActual() u: UsuarioToken,
    @Req() req: Request,
  ): Promise<RespuestaApi<{ reserva: ReservaHost; ya_confirmado: boolean }>> {
    const r = await this.host.confirmarPago(id, u);
    auditar('pago_confirmado', req, { reserva_id: id, codigo: r.reserva.codigo, ya_confirmado: r.ya_confirmado });
    return ok(r, r.ya_confirmado ? 'El pago ya estaba confirmado' : 'Pago en efectivo confirmado');
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancelar una reserva como administrador',
    description: 'Cancela una reserva PENDIENTE o CONFIRMADA. Al cancelar el administrador no hay penalidad: se reembolsa todo lo cobrado y se anula la factura. ' +
      'Body opcional: { "motivo": "…" } (máx. 300). 409 si ya estaba cancelada/completada, si el huésped ya llegó o si es del canal Booking. Queda en la auditoría.',
  })
  @ApiResponse({ status: 409, description: 'La reserva no se puede cancelar en su estado actual' })
  async cancelar(
    @Param('id', uuid('id')) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @UsuarioActual() u: UsuarioToken,
    @Req() req: Request,
  ): Promise<RespuestaApi<{ reserva: ReservaHost; penalidad: number; reembolso: number }>> {
    const r = await this.host.cancelar(id, body && typeof body === 'object' ? body['motivo'] : undefined, u);
    auditar('operacion_critica', req, { reserva_id: id, codigo: r.reserva.codigo, accion: 'cancelacion_admin', reembolso: r.reembolso });
    return ok(r, 'Reserva cancelada');
  }

  @Post('orders/:id/arrival')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check-in en recepción: el huésped llegó',
    description: 'Solo reservas confirmadas del canal Booking. Marca la llegada, asigna habitación y avisa a Booking ' +
      '(POST /api/v2/reservas/{id}/checkin). Idempotente. Si Booking no responde, `booking_notificado` es false y el aviso se reintenta solo.',
  })
  @ApiResponse({ status: 409, description: 'La reserva no es del canal Booking o no está confirmada' })
  async llegada(
    @Param('id', uuid('id')) id: string,
    @Body() body: Record<string, unknown> | undefined,
    @UsuarioActual() u: UsuarioToken,
    @Req() req: Request,
  ): Promise<RespuestaApi<RespuestaLlegada>> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const r = await this.host.registrarLlegada(
      id,
      {
        observaciones: b.observaciones as string | undefined,
        huespedes_reales: b.huespedes_reales as number | undefined,
        admin_id: b.admin_id as string | undefined,
        habitacion: b.habitacion as string | undefined,
      },
      u,
    );
    auditar('operacion_critica', req, { reserva_id: id, accion: 'checkin_recepcion', ya_registrado: r.ya_registrado, booking_notificado: r.booking_notificado });
    return ok(r, r.booking_notificado ? 'Llegada registrada y Booking notificado' : 'Llegada registrada; Booking se notificará en breve (reintento automático)');
  }

  @Get('income')
  @ApiOperation({ summary: 'Ingresos por mes (v_ingresos_anfitrion)' })
  async ingresos(@UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<{ mes: string; estancias: number; ingreso_sin_iva: number }[]>> {
    return ok(await this.host.ingresos(u));
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Reseñas de mis alojamientos' })
  async resenas(@UsuarioActual() u: UsuarioToken): Promise<RespuestaApi<Record<string, unknown>[]>> {
    return ok(await this.host.resenas(u));
  }

  @Post('reviews/:id/reply')
  @ApiOperation({ summary: 'Responder una reseña' })
  async responderResena(
    @Param('id', uuid('id')) id: string,
    @Body() dto: ResponderResenaDto,
    @UsuarioActual() u: UsuarioToken,
  ): Promise<RespuestaApi<{ id: string }>> {
    return ok(await this.host.responderResena(id, dto.respuesta, u), 'Respuesta publicada');
  }
}
