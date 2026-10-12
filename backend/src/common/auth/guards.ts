import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DbService } from '../../database/db.service';
import { ProblemException, prohibido } from '../problem/problem';
import { ES_PUBLICO, Rol, ROLES, Scope, SCOPES, SCOPES_POR_ROL, UsuarioToken } from './decorators';

/** Cuánto se recuerda el estado del usuario (segundos): un cambio de rol o una desactivación surte efecto en este plazo. */
export const TTL_ESTADO_USUARIO_MS = 10_000;

/** Guard global: exige un Bearer JWT HS256 válido salvo en rutas @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly estados = new Map<string, { activo: boolean; rol: Rol; hasta: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  /** Estado vigente del usuario en la BD (con una caché corta). null = el usuario ya no existe. */
  private async estadoActual(id: string): Promise<{ activo: boolean; rol: Rol } | null> {
    const ahora = Date.now();
    const guardado = this.estados.get(id);
    if (guardado && guardado.hasta > ahora) return guardado;
    const fila = await this.db.uno<{ activo: boolean; rol: Rol }>(`SELECT activo, rol::text AS rol FROM usuario WHERE id = $1`, [id]);
    if (!fila) {
      this.estados.delete(id);
      return null;
    }
    if (this.estados.size > 5000) this.estados.clear(); // tope de memoria
    this.estados.set(id, { activo: fila.activo, rol: fila.rol, hasta: ahora + TTL_ESTADO_USUARIO_MS });
    return fila;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const [tipo, token] = (req.header('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) throw new ProblemException(401, 'VALIDATION_FAILED', 'Falta el token de acceso');
    try {
      req.user = await this.jwt.verifyAsync<UsuarioToken>(token, { algorithms: ['HS256'] });
    } catch {
      throw new ProblemException(401, 'VALIDATION_FAILED', 'Token inválido o expirado');
    }
    // El token no basta: se confirma en la BD que la cuenta siga activa y se toma el ROL vigente (no el congelado en el token)
    const estado = await this.estadoActual(req.user.sub);
    if (!estado || !estado.activo) throw new ProblemException(401, 'VALIDATION_FAILED', 'La cuenta no está activa');
    if (estado.rol !== req.user.rol) req.user = { ...req.user, rol: estado.rol, scope: SCOPES_POR_ROL[estado.rol].join(' ') };
    return true;
  }
}

/** Verifica el rol declarado con @Roles(). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user || !roles.includes(user.rol)) throw prohibido('Tu rol no permite esta operación');
    return true;
  }
}

/** Verifica que el claim `scope` del JWT contenga los scopes de @Scopes(). */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<Scope[]>(SCOPES, [ctx.getHandler(), ctx.getClass()]);
    if (!requeridos?.length) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    const concedidos = (user?.scope ?? '').split(' ');
    const faltan = requeridos.filter((s) => !concedidos.includes(s));
    if (faltan.length) throw prohibido(`Falta el scope: ${faltan.join(', ')}`);
    return true;
  }
}
