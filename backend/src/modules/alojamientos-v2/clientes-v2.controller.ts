import { Body, Controller, Get, HttpCode, HttpStatus, Query, Res } from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { Scopes } from '../../common/auth/decorators';
import { InvalidParam, ProblemException } from '../../common/problem/problem';
import { logJson } from '../../common/logging/log-json';
import { DbService } from '../../database/db.service';
import { ClienteV2, asegurarCliente, buscarCliente } from './clientes-v2';
import { RE_EMAIL, camposDesconocidos, lanzarSiHayErrores, noEncontradoV2, soloObjeto } from './util-v2';

const RE_IDENT = /^[A-Za-z0-9]{6,20}$/;
const RE_TEL = /^\+?[0-9]{7,15}$/;

const vista = (c: ClienteV2): Record<string, unknown> => ({
  client_id: c.client_id,
  nombre: c.nombre,
  email: c.email,
  identificacion: c.identificacion,
  ...(c.telefono ? { telefono: c.telefono } : {}),
});

/**
 * Módulo de huéspedes para Booking (requisito de la defensa): Booking consulta si el huésped ya tiene ficha
 * y, si no, la crea. Así un huésped creado en Booking existe en Posada sin duplicarse.
 */
@ApiExcludeController()
@Controller('api/v2/clientes')
export class ClientesV2Controller {
  constructor(private readonly db: DbService) {}

  /** GET /api/v2/clientes?email=...&identificacion=...  → 200 con la ficha, o 404 si no existe. */
  @Get()
  @Scopes('alojamientos:read')
  async consultar(@Query() q: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const errores: InvalidParam[] = [];
    if (q.email === undefined && q.identificacion === undefined) errores.push({ name: 'email', reason: 'envíe email y/o identificacion' });
    if (q.email !== undefined && (q.email.length > 160 || !RE_EMAIL.test(q.email))) errores.push({ name: 'email', reason: 'correo no válido' });
    if (q.identificacion !== undefined && !RE_IDENT.test(q.identificacion)) errores.push({ name: 'identificacion', reason: '6 a 20 caracteres alfanuméricos' });
    lanzarSiHayErrores(errores);
    const c = await buscarCliente((s, p) => this.db.query(s, p), q.email, q.identificacion);
    if (!c) throw noEncontradoV2('El huésped no tiene ficha en Posada EC');
    return vista(c);
  }

  /** POST /api/v2/clientes → 201 con { client_id } si se creó; 200 con el mismo client_id si ya existía. */
  @Post()
  @Scopes('alojamientos:book')
  @HttpCode(HttpStatus.CREATED)
  async crear(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    const b = soloObjeto(body);
    const errores: InvalidParam[] = [];
    camposDesconocidos(b, ['nombre', 'email', 'identificacion', 'telefono'], errores);
    if (typeof b.nombre !== 'string' || b.nombre.trim().length < 2 || b.nombre.length > 160) errores.push({ name: 'nombre', reason: '2 a 160 caracteres' });
    if (typeof b.email !== 'string' || b.email.length > 160 || !RE_EMAIL.test(b.email)) errores.push({ name: 'email', reason: 'correo no válido' });
    if (typeof b.identificacion !== 'string' || !RE_IDENT.test(b.identificacion)) errores.push({ name: 'identificacion', reason: '6 a 20 caracteres alfanuméricos' });
    if (b.telefono !== undefined && b.telefono !== null && (typeof b.telefono !== 'string' || !RE_TEL.test(b.telefono))) errores.push({ name: 'telefono', reason: '7 a 15 dígitos, opcional +' });
    lanzarSiHayErrores(errores);

    const r = await this.db.transaccion((q) =>
      asegurarCliente(q, {
        nombre: (b.nombre as string).trim(),
        email: b.email as string,
        identificacion: b.identificacion as string,
        telefono: (b.telefono as string | null | undefined) ?? null,
      }),
    );
    if ('conflicto' in r) {
      throw new ProblemException(409, 'CONFLICT', 'El correo y la identificación pertenecen a huéspedes distintos', [
        { name: 'email', reason: 'ya registrado con otra identificación' },
      ]);
    }
    if (!r.creado) res.status(HttpStatus.OK);
    logJson('info', 'cliente_v2', { client_id: r.cliente.client_id, creado: r.creado });
    return { client_id: r.cliente.client_id };
  }
}
