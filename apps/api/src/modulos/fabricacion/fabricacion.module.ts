// src/modulos/fabricacion/fabricacion.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos, PublicadorEventos } from '../../infraestructura/eventos';
import { RegistroComandosSync } from '../sincronizacion';
import { ErrorNegocio } from '../../kernel/errores';

@Module({})
export class FabricacionModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos, private readonly sync: RegistroComandosSync,
  ) {}

  onModuleInit() {
    // R1 + R4: por cada línea con faltante se crea UNA OF. La clave única hace seguro el reintento del evento.
    this.bus.suscribir('pedidos.PedidoConfirmado', async (e) => {
      const { pedidoId, bodegaId, lineas } = e.payload;
      await this.bd.transaccion(async () => {
        for (const l of lineas.filter((x: any) => x.aFabricar > 0)) {
          await this.bd.consultar(
            `INSERT INTO fabricacion.orden_fabricacion
               (id, empresa_id, numero, articulo_id, cantidad, estado, pedido_id, pedido_linea_id, clave_origen, bodega_destino_id)
             VALUES (gen_random_uuid(), $1, 'OF-' || lpad(nextval('fabricacion.seq_orden_fabricacion')::text, 8, '0'),
                     $2, $3, 'PLANIFICADA', $4, $5, $6, $7)
             ON CONFLICT ON CONSTRAINT uq_r4_clave_origen DO NOTHING`,
            [e.empresa_id, l.articuloId, l.aFabricar, pedidoId, l.pedidoLineaId, `pedido_linea:${l.pedidoLineaId}`, bodegaId]);
        }
      });
    });

    // Planificador: liberar OF
    this.sync.registrar('fabricacion.orden.liberar', async (u, d: { ordenId: string }) => {
      const r = await this.bd.consultar(
        `UPDATE fabricacion.orden_fabricacion SET estado='LIBERADA', liberada_por=$3, liberada_en=now()
          WHERE id=$1 AND empresa_id=$2 AND estado='PLANIFICADA' RETURNING id`, [d.ordenId, u.empresaId, u.id]);
      if (r.length === 0) throw new ErrorNegocio('OF_NO_LIBERABLE', 'La OF no existe o no está planificada');
      return {};
    });

    // Planificador: reportar cantidades producidas (idempotente por idempotencyKey)
    this.sync.registrar('fabricacion.orden.reportar', async (u, d: { ordenId: string; cantidad: number }, clave) => {
      const nuevo = await this.bd.consultar(
        `INSERT INTO fabricacion.reporte_produccion (empresa_id, orden_id, cantidad, reportado_por, idempotency_key)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [u.empresaId, d.ordenId, d.cantidad, u.id, clave]);
      if (nuevo.length === 0) return {};
      const [o] = await this.bd.consultar(
        `UPDATE fabricacion.orden_fabricacion
            SET cantidad_producida = cantidad_producida + $3,
                estado = CASE WHEN cantidad_producida + $3 >= cantidad THEN 'TERMINADA' ELSE 'EN_PROCESO' END
          WHERE id=$1 AND empresa_id=$2 AND estado IN ('LIBERADA','EN_PROCESO')
          RETURNING id, estado, articulo_id, cantidad_producida, pedido_id, pedido_linea_id, bodega_destino_id`,
        [d.ordenId, u.empresaId, d.cantidad]);
      if (!o) throw new ErrorNegocio('OF_NO_REPORTABLE', 'La OF no está liberada o en proceso');
      if (o.estado === 'TERMINADA') {
        await this.eventos.publicar([{
          tipo: 'fabricacion.OrdenFabricacionTerminada', agregadoId: o.id, empresaId: u.empresaId, ocurrioEn: new Date(),
          datos: { ordenId: o.id, articuloId: o.articulo_id, bodegaId: o.bodega_destino_id, cantidad: Number(o.cantidad_producida),
                   pedidoId: o.pedido_id, pedidoLineaId: o.pedido_linea_id },
        }]);
      }
      return {};
    });
  }
}
