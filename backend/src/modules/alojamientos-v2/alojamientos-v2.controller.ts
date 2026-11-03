import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
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
}
