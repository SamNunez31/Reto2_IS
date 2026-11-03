import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { Public, Scopes, UsuarioActual, UsuarioToken } from '../../common/auth/decorators';
import { IdempotencyKeyGuard } from '../../common/guards/idempotency-key.guard';
import { Idempotente, IdempotenciaInterceptor } from '../../common/idempotencia/idempotencia.interceptor';
import { AlojamientosV2Service } from './alojamientos-v2.service';

/**
 * Contrato v2.2.0 (alojamientos-openapi-v2.yaml) bajo /api/v2/alojamientos.
 * Convive con el contrato v1 (/api/v1) hasta que el gateway del Reto 2 enrute por versión.
 * Las rutas estáticas van antes que cualquier /{id}.
 */
@ApiExcludeController()
@Controller('api/v2/alojamientos')
export class AlojamientosV2Controller {
  constructor(private readonly servicio: AlojamientosV2Service) {}

  /** Semáforo del nodo (lo consulta el Monitor de Nodos cada 5 s). */
  @Get('health')
  @Public()
  @SkipThrottle()
  async health(@Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    const { http, cuerpo } = await this.servicio.health();
    res.status(http);
    if (http === 503) res.setHeader('Retry-After', '30');
    return cuerpo;
  }

  /** Catálogo paginado con ETag / If-None-Match. */
  @Get()
  @Public()
  async catalogo(@Query() q: Record<string, string | undefined>, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown> | undefined> {
    const cuerpo = await this.servicio.catalogo(q);
    const etag = `"${createHash('md5').update(JSON.stringify(cuerpo)).digest('hex')}"`;
    res.setHeader('ETag', etag);
    if (req.header('if-none-match') === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return cuerpo;
  }

  /** Disponibilidad exacta + cotización con precio congelado 30 min (no retiene inventario). */
  @Post('availability')
  @Public()
  @HttpCode(200)
  disponibilidad(@Body() body: unknown): Promise<Record<string, unknown>> {
    return this.servicio.disponibilidad(body);
  }

  /** Búsqueda con fechas y ocupantes (calcula precioTotalEstancia; no retiene inventario). */
  @Post('search')
  @Public()
  @HttpCode(200)
  buscar(@Body() body: unknown, @Query() q: Record<string, string | undefined>, @Req() req: Request): Promise<Record<string, unknown>> {
    return this.servicio.buscar(body, q, req.correlationId ?? `req-alo-${Date.now()}`);
  }

  /** Recuperación tras timeout del ESB: ?saga_id=…, ?idempotency_key=… o ?external_order_id=…. */
  @Get('orders')
  @Scopes('alojamientos:read')
  @Header('Cache-Control', 'no-store')
  listar(@Query() q: Record<string, string | undefined>, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.listarOrdenes(q, usuario);
  }

  /** Acuerdo B2B de promociones (lo consulta Booking antes de armar combos). */
  @Get('promociones/contrato')
  @Scopes('alojamientos:read')
  contratoPromociones(): Promise<Record<string, unknown>> {
    return this.servicio.obtenerContratoPromociones();
  }

  @Put('promociones/contrato')
  @Scopes('alojamientos:admin')
  guardarContratoPromociones(@Body() body: unknown): Promise<Record<string, unknown>> {
    return this.servicio.guardarContratoPromociones(body);
  }

  /** Feed CloudEvents del Transactional Outbox (orden estricto por sequence). */
  @Get('eventos')
  @Scopes('alojamientos:inventory')
  @Header('Cache-Control', 'no-store')
  eventos(@Query() q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.servicio.eventos(q);
  }

  /** Categorías de alojamiento (público, con ETag). */
  @Get('categorias')
  @Public()
  async categorias(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>[] | undefined> {
    return this.conEtag(await this.servicio.categorias(), req, res);
  }

  /** Mis reservas (BearerAuth). */
  @Get('reservations')
  @Header('Cache-Control', 'no-store')
  misReservas(@Query() q: Record<string, string | undefined>, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.misReservas(q, usuario);
  }

  /** Crear reserva: contrato síncrono de la Saga (≤ 3000 ms). Idempotente. */
  @Post('orders/create')
  @HttpCode(HttpStatus.CREATED)
  @Scopes('alojamientos:book')
  @UseGuards(IdempotencyKeyGuard)
  @UseInterceptors(IdempotenciaInterceptor)
  @Idempotente('orders.create.v2')
  async crear(
    @Body() body: unknown,
    @UsuarioActual() usuario: UsuarioToken,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    const orden = await this.servicio.crearOrden(body, usuario, req.header('idempotency-key') as string);
    res.setHeader('Location', `${(process.env.API_PUBLIC_URL || '').replace(/\/$/, '')}/api/v2/alojamientos/orders/${String(orden.external_order_id)}`);
    return orden;
  }

  /** Inventario por noche: lo usa Booking para reconciliar el stock cuando el hash gRPC no coincide. */
  @Get(':id/inventario')
  @Scopes('alojamientos:inventory')
  inventario(@Param('id') id: string, @Query() q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.servicio.inventario(id, q);
  }

  /** Acepta orderId (UUID), externalOrderId (ORD-HTL-…) o codigoReserva (BK-HOTEL-…). */
  @Get('orders/:orderId')
  @Scopes('alojamientos:read')
  @Header('Cache-Control', 'no-store')
  obtener(@Param('orderId') ref: string, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.obtenerOrden(ref, usuario);
  }

  /** Compensación de la Saga: idempotente, devuelve el mismo codigoReembolso en cada reintento. */
  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @Scopes('alojamientos:cancel')
  @UseGuards(IdempotencyKeyGuard)
  @UseInterceptors(IdempotenciaInterceptor)
  @Idempotente('orders.cancel.v2')
  cancelar(@Param('orderId') ref: string, @Body() body: unknown, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.cancelarOrden(ref, body, usuario);
  }

  @Post('orders/:orderId/check-in')
  @HttpCode(200)
  @Scopes('alojamientos:checkin')
  checkIn(@Param('orderId') ref: string, @Body() body: unknown, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.checkIn(ref, body, usuario);
  }

  @Put('orders/:orderId/early-checkin')
  @Scopes('alojamientos:admin')
  earlyCheckin(@Param('orderId') ref: string, @Body() body: unknown, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.earlyCheckin(ref, body, usuario);
  }

  @Post('orders/:orderId/checkout')
  @HttpCode(200)
  @Scopes('alojamientos:checkin')
  checkOut(@Param('orderId') ref: string, @Body() body: unknown, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.checkOut(ref, body, usuario);
  }

  /** Ficha pública del alojamiento (HTL-<codigo> o UUID). Va al final: rutas dinámicas. */
  @Get(':id')
  @Public()
  async detalle(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown> | undefined> {
    return this.conEtag(await this.servicio.detalleAlojamiento(id), req, res);
  }

  @Get(':id/habitaciones')
  @Public()
  async habitaciones(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown> | undefined> {
    return this.conEtag(await this.servicio.habitaciones(id), req, res);
  }

  @Get(':id/availability')
  @Public()
  disponibilidadGet(@Param('id') id: string, @Query() q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.servicio.disponibilidadIndicativa(id, q);
  }

  @Get(':id/resenas')
  @Public()
  resenas(@Param('id') id: string, @Query() q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    return this.servicio.resenas(id, q);
  }

  @Post(':id/resenas')
  @HttpCode(HttpStatus.CREATED)
  crearResena(@Param('id') id: string, @Body() body: unknown, @UsuarioActual() usuario: UsuarioToken): Promise<Record<string, unknown>> {
    return this.servicio.crearResena(id, body, usuario);
  }

  /** ETag débil de lectura pública: 304 si el cliente ya tiene la misma versión. */
  private conEtag<T>(cuerpo: T, req: Request, res: Response): T | undefined {
    const etag = `"${createHash('md5').update(JSON.stringify(cuerpo)).digest('hex')}"`;
    res.setHeader('ETag', etag);
    if (req.header('if-none-match') === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return cuerpo;
  }
}
