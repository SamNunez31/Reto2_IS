import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './guards';

/** Contexto HTTP mínimo con un Bearer token y el objeto request (para ver req.user). */
function contexto(token = 'tok') {
  const req: { user?: { sub: string; rol: string; scope: string; email: string } } & { header: (n: string) => string | undefined } = {
    header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
  return { ctx, req };
}

function armar(claims: Record<string, unknown> | null, fila: { activo: boolean; rol: string } | null) {
  const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
  const jwt = { verifyAsync: jest.fn(async () => { if (!claims) throw new Error('mal'); return claims; }) };
  const db = { uno: jest.fn(async () => fila) };
  const guard = new JwtAuthGuard(reflector, jwt as never, db as never);
  return { guard, db };
}

const claims = { sub: 'u1', email: 'a@a.com', rol: 'ADMIN', scope: 'alojamientos:read alojamientos:webhooks' };

describe('JwtAuthGuard (revalidación contra la BD)', () => {
  it('deja pasar a un usuario activo', async () => {
    const { guard } = armar(claims, { activo: true, rol: 'ADMIN' });
    const { ctx, req } = contexto();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user?.rol).toBe('ADMIN');
  });

  it('rechaza con 401 un token válido de una cuenta desactivada', async () => {
    const { guard } = armar(claims, { activo: false, rol: 'ADMIN' });
    const e = await guard.canActivate(contexto().ctx).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(401);
  });

  it('rechaza con 401 si el usuario ya no existe', async () => {
    const { guard } = armar(claims, null);
    const e = await guard.canActivate(contexto().ctx).catch((x) => x);
    expect((e as HttpException).getStatus()).toBe(401);
  });

  it('usa el rol vigente de la BD, no el congelado en el token (admin degradado)', async () => {
    const { guard } = armar(claims, { activo: true, rol: 'USUARIO' });
    const { ctx, req } = contexto();
    await guard.canActivate(ctx);
    expect(req.user?.rol).toBe('USUARIO');
    expect(req.user?.scope).toContain('alojamientos:book');
    expect(req.user?.scope).not.toContain('alojamientos:webhooks');
  });

  it('recuerda el estado unos segundos (una sola consulta para dos peticiones seguidas)', async () => {
    const { guard, db } = armar(claims, { activo: true, rol: 'ADMIN' });
    await guard.canActivate(contexto().ctx);
    await guard.canActivate(contexto().ctx);
    expect(db.uno).toHaveBeenCalledTimes(1);
  });

  it('rechaza con 401 un token inválido', async () => {
    const { guard } = armar(null, null);
    const e = await guard.canActivate(contexto().ctx).catch((x) => x);
    expect((e as HttpException).getStatus()).toBe(401);
  });
});
