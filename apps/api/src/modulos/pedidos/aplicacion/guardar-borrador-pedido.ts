// src/modulos/pedidos/aplicacion/guardar-borrador-pedido.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Dinero } from '../../../kernel/dinero';
import { ErrorNegocio } from '../../../kernel/errores';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Pedido, PEDIDO_REPOSITORIO, PedidoRepositorio } from '../dominio/pedido';

export const BorradorPedidoSchema = z.object({
  id: z.string().uuid(),
  clienteId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  canal: z.enum(['MOSTRADOR', 'WEB', 'TELEFONO']).default('MOSTRADOR'),
  condicionPago: z.enum(['CONTADO', 'CREDITO']).default('CONTADO'),
  lineas: z.array(z.object({
    id: z.string().uuid(), articuloId: z.string().uuid(), descripcion: z.string(),
    cantidad: z.number().positive(), precioUnitario: z.number().nonnegative(),
    descuentoPct: z.number().min(0).max(100).default(0), ivaPct: z.number().min(0).max(100).default(0),
  })).min(1),
});

@Injectable()
export class GuardarBorradorPedido {
  constructor(@Inject(PEDIDO_REPOSITORIO) private readonly repo: PedidoRepositorio, private readonly bd: BaseDatos) {}

  async ejecutar(empresaId: string, vendedorId: string, entrada: unknown): Promise<void> {
    const d = BorradorPedidoSchema.parse(entrada);
    // OJO: el precio llega del cliente (copia local). En un sistema real se revalida contra catalogo.articulo
    // mediante un puerto antes de confirmar (el servidor es la fuente de verdad de precios e impuestos).
    const lineas = d.lineas.map(l => ({ ...l, precioUnitario: Dinero.de(l.precioUnitario) }));
    await this.bd.transaccion(async () => {
      const existente = await this.repo.obtener(d.id, empresaId);
      if (existente) {
        const r = existente.reemplazarLineas(lineas);
        if (!r.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', r.error);
        return this.repo.guardar(existente);
      }
      const nuevo = Pedido.crearBorrador({
        id: d.id, empresaId, clienteId: d.clienteId, vendedorId, bodegaId: d.bodegaId,
        canal: d.canal, condicionPago: d.condicionPago, lineas,
      });
      if (!nuevo.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', nuevo.error);
      await this.repo.guardar(nuevo.valor);
    });
  }
}
