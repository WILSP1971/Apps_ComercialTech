// packages/contratos/src/eventos.ts
import { z } from 'zod';

export const PedidoConfirmadoV1 = z.object({
  pedidoId: z.string().uuid(),
  numero: z.string(),
  clienteId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  condicionPago: z.enum(['CONTADO', 'CREDITO']),
  total: z.number(),
  lineas: z.array(z.object({
    pedidoLineaId: z.string().uuid(),
    articuloId: z.string().uuid(),
    cantidad: z.number().positive(),
    reservada: z.number().min(0),
    aFabricar: z.number().min(0),          // > 0 => Fabricación crea OF (R1)
  })),
});
export type PedidoConfirmadoV1 = z.infer<typeof PedidoConfirmadoV1>;
