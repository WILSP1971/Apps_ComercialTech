// src/modulos/pedidos/infraestructura/pedido.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Dinero } from '../../../kernel/dinero';
import { Pedido, PedidoRepositorio } from '../dominio/pedido';

const estadoAbastecimiento = (cant: number, res: number, fab: number) =>
  res >= cant ? 'RESERVADO' : res > 0 && fab > 0 ? 'MIXTO' : fab > 0 ? 'EN_FABRICACION' : 'PENDIENTE';

@Injectable()
export class PedidoRepositorioPg implements PedidoRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async obtener(id: string, empresaId: string): Promise<Pedido | null> {
    const [p] = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido WHERE id = $1 AND empresa_id = $2 AND eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    if (!p) return null;
    const lineas = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido_linea WHERE pedido_id = $1 AND eliminado_en IS NULL ORDER BY creado_en, id`, [id]);
    return Pedido.reconstituir({
      id: p.id, empresaId: p.empresa_id, clienteId: p.cliente_id, vendedorId: p.vendedor_id, bodegaId: p.bodega_id,
      canal: p.canal, condicionPago: p.condicion_pago, estado: p.estado, numero: p.numero,
      motivoRechazo: p.motivo_rechazo, version: p.version,
      lineas: lineas.map((l: any) => ({
        id: l.id, articuloId: l.articulo_id, descripcion: l.descripcion, cantidad: Number(l.cantidad),
        precioUnitario: Dinero.de(Number(l.precio_unitario)), descuentoPct: Number(l.descuento_pct), ivaPct: Number(l.iva_pct),
        cantidadReservada: Number(l.cantidad_reservada), cantidadAFabricar: Number(l.cantidad_a_fabricar),
      })),
    });
  }

  async guardar(pedido: Pedido): Promise<void> {
    const s = pedido.snapshot;
    await this.bd.consultar(
      `INSERT INTO pedidos.pedido (id, empresa_id, numero, cliente_id, vendedor_id, bodega_id, canal, condicion_pago,
                                   estado, motivo_rechazo, subtotal, impuestos, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET numero=$3, estado=$9, motivo_rechazo=$10, subtotal=$11, impuestos=$12, total=$13`,
      [s.id, s.empresaId, s.numero, s.clienteId, s.vendedorId, s.bodegaId, s.canal, s.condicionPago,
       s.estado, s.motivoRechazo, pedido.subtotal().valor, pedido.impuestos().valor, pedido.total().valor]);

    // Borrado lógico de líneas retiradas (para que los dispositivos se enteren)
    await this.bd.consultar(
      `UPDATE pedidos.pedido_linea SET eliminado_en = now() WHERE pedido_id = $1 AND eliminado_en IS NULL AND id <> ALL($2::uuid[])`,
      [s.id, s.lineas.map(l => l.id)]);

    for (const l of s.lineas) {
      const totalLinea = l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100)).valor;
      await this.bd.consultar(
        `INSERT INTO pedidos.pedido_linea (id, empresa_id, pedido_id, articulo_id, descripcion, cantidad, precio_unitario,
                                           descuento_pct, iva_pct, total_linea, cantidad_reservada, cantidad_a_fabricar, estado_abastecimiento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET cantidad=$6, precio_unitario=$7, descuento_pct=$8, iva_pct=$9, total_linea=$10,
           descripcion=$5, cantidad_reservada=$11, cantidad_a_fabricar=$12, estado_abastecimiento=$13, eliminado_en=NULL`,
        [l.id, s.empresaId, s.id, l.articuloId, l.descripcion, l.cantidad, l.precioUnitario.valor, l.descuentoPct,
         l.ivaPct, totalLinea, l.cantidadReservada, l.cantidadAFabricar,
         estadoAbastecimiento(l.cantidad, l.cantidadReservada, l.cantidadAFabricar)]);
    }
  }

  async siguienteNumero(empresaId: string, serie: string): Promise<string> {
    const [r] = await this.bd.consultar(
      `INSERT INTO pedidos.consecutivo (empresa_id, serie, ultimo) VALUES ($1,$2,1)
       ON CONFLICT (empresa_id, serie) DO UPDATE SET ultimo = pedidos.consecutivo.ultimo + 1
       RETURNING ultimo`, [empresaId, serie]);
    return `${serie}-${String(r.ultimo).padStart(8, '0')}`;
  }
}
