// src/infraestructura/auth.ts
import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { BaseDatos } from './base-datos';

export const Permiso = (codigo: string) => SetMetadata('permiso', codigo);

// Claves públicas del emisor (se cachean automáticamente)
const jwks = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!));
// Si tu instancia firma con HS256 (secreto compartido), usa en su lugar:
// const secreto = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
// y llama jwtVerify(token, secreto, {...})

export interface UsuarioAutenticado {
  id: string; empresaId: string; roles: string[]; permisos: string[];
  clienteId: string | null;          // solo para el rol 'cliente_web'
}

@Injectable()
export class AuthGuard implements CanActivate {
  private cache = new Map<string, { u: UsuarioAutenticado; hasta: number }>();
  constructor(private readonly bd: BaseDatos, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Falta el token');

    let sub: string;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE,
      });
      sub = String(payload.sub);
    } catch { throw new UnauthorizedException('Token inválido o vencido'); }

    const empresaSolicitada = (req.headers['x-empresa-id'] as string | undefined) ?? null;
    const llave = `${sub}:${empresaSolicitada}`;
    let entrada = this.cache.get(llave);
    if (!entrada || entrada.hasta < Date.now()) {
      // Se UNEN los permisos de todos los roles que el usuario tiene en la empresa
      const [f] = await this.bd.consultar(
        `SELECT ue.empresa_id,
                array_agg(DISTINCT r.codigo) AS roles,
                array_remove(array_agg(DISTINCT p.codigo), NULL) AS permisos,
                max(ue.cliente_id::text) AS cliente_id
           FROM seguridad.usuario_empresa ue
           JOIN seguridad.rol r ON r.id = ue.rol_id
           LEFT JOIN seguridad.rol_permiso rp ON rp.rol_id = r.id
           LEFT JOIN seguridad.permiso p ON p.id = rp.permiso_id
          WHERE ue.usuario_id = $1 AND ue.activo AND ($2::uuid IS NULL OR ue.empresa_id = $2::uuid)
          GROUP BY ue.empresa_id
          LIMIT 1`, [sub, empresaSolicitada]);
      if (!f) throw new ForbiddenException('Sin acceso a la empresa');
      entrada = {
        u: { id: sub, empresaId: f.empresa_id, roles: f.roles, permisos: f.permisos, clienteId: f.cliente_id },
        hasta: Date.now() + 60_000,
      };
      this.cache.set(llave, entrada);
    }
    req.usuario = entrada.u;

    const requerido = this.reflector.get<string>('permiso', ctx.getHandler());
    if (requerido && !entrada.u.permisos.includes(requerido) && !entrada.u.roles.includes('administrador'))
      throw new ForbiddenException(`Falta el permiso ${requerido}`);
    return true;
  }
}
