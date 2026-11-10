// src/modulos/compras/aplicacion/guardar-proveedor.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import { Proveedor } from '../dominio/proveedor';
import { PROVEEDOR_REPOSITORIO, ProveedorRepositorio } from '../dominio/repositorios';

export const ProveedorSchema = z.object({
  id: z.string().uuid(),
  nit: z.string().min(5),
  razonSocial: z.string().min(2),
  correo: z.string().email().optional(),
  telefono: z.string().optional(),
  plazoDias: z.number().int().min(0).max(365).default(0),
});

@Injectable()
export class GuardarProveedor {
  constructor(@Inject(PROVEEDOR_REPOSITORIO) private readonly proveedores: ProveedorRepositorio, private readonly bd: BaseDatos) {}

  async ejecutar(u: { empresaId: string }, entrada: unknown) {
    const d = ProveedorSchema.parse(entrada);
    const datos = { nit: d.nit, razonSocial: d.razonSocial, correo: d.correo ?? null, telefono: d.telefono ?? null, plazoDias: d.plazoDias };
    try {
      await this.bd.transaccion(async () => {
        const existente = await this.proveedores.obtener(d.id, u.empresaId);
        if (existente) {
          lanzarSiFalla(existente.actualizar(datos));
          await this.proveedores.guardar(existente);
        } else {
          await this.proveedores.guardar(lanzarSiFalla(Proveedor.crear({ id: d.id, empresaId: u.empresaId, ...datos })));
        }
      });
    } catch (e: any) {
      if (e.code === '23505') throw new ErrorNegocio('PROVEEDOR_DUPLICADO', 'Ya existe un proveedor con ese NIT');
      throw e;
    }
    return {};
  }
}

@Injectable()
export class CambiarEstadoProveedor {
  constructor(@Inject(PROVEEDOR_REPOSITORIO) private readonly proveedores: ProveedorRepositorio, private readonly bd: BaseDatos) {}

  async desactivar(u: { empresaId: string }, id: string) {
    return this.bd.transaccion(async () => {
      const p = await this.proveedores.obtener(id, u.empresaId);
      if (!p) throw new ErrorNegocio('PROVEEDOR_NO_EXISTE', 'El proveedor no existe');
      if (await this.proveedores.tieneOrdenesAbiertas(id, u.empresaId))
        throw new ErrorNegocio('PROVEEDOR_CON_ORDENES', 'El proveedor tiene órdenes de compra abiertas');
      p.desactivar();
      await this.proveedores.guardar(p);
      return {};
    });
  }

  async activar(u: { empresaId: string }, id: string) {
    return this.bd.transaccion(async () => {
      const p = await this.proveedores.obtener(id, u.empresaId);
      if (!p) throw new ErrorNegocio('PROVEEDOR_NO_EXISTE', 'El proveedor no existe');
      p.activar();
      await this.proveedores.guardar(p);
      return {};
    });
  }
}
