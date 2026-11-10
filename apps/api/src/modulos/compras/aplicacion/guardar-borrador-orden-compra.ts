// src/modulos/compras/aplicacion/guardar-borrador-orden-compra.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ErrorNegocio } from '../../../kernel/errores';
import { lanzarSiFalla } from '../../../kernel/error-dominio';
import { OrdenCompra } from '../dominio/orden-compra';
import {
  ORDEN_COMPRA_REPOSITORIO, OrdenCompraRepositorio, PROVEEDOR_REPOSITORIO, ProveedorRepositorio,
} from '../dominio/repositorios';

export const OrdenCompraSchema = z.object({
  id: z.string().uuid(),
  proveedorId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  fechaEsperada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  observaciones: z.string().max(500).optional(),
  lineas: z.array(z.object({
    id: z.string().uuid(), articuloId: z.string().uuid(),
    cantidad: z.number().positive(), costoUnitario: z.number().nonnegative(),
  })).min(1),
});

@Injectable()
export class GuardarBorradorOrdenCompra {
  constructor(
    @Inject(ORDEN_COMPRA_REPOSITORIO) private readonly ordenes: OrdenCompraRepositorio,
    @Inject(PROVEEDOR_REPOSITORIO) private readonly proveedores: ProveedorRepositorio,
    private readonly bd: BaseDatos,
  ) {}

  /** Comprador: crea o edita el borrador. Funciona también como comando offline (idempotente por id). */
  async ejecutar(u: { empresaId: string; id: string }, entrada: unknown) {
    const d = OrdenCompraSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const prov = await this.proveedores.obtener(d.proveedorId, u.empresaId);
      if (!prov || !prov.activo) throw new ErrorNegocio('PROVEEDOR_NO_VALIDO', 'El proveedor no existe o está inactivo');

      const existente = await this.ordenes.obtener(d.id, u.empresaId);
      if (existente) {
        lanzarSiFalla(existente.actualizar(d));
        await this.ordenes.guardar(existente);
      } else {
        const nueva = lanzarSiFalla(OrdenCompra.crearBorrador({ ...d, empresaId: u.empresaId, creadoPor: u.id }));
        await this.ordenes.guardar(nueva);
      }
      return {};
    });
  }
}
