// src/offline/repos/pedidos.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

export interface LineaBorrador {
  id: string; articuloId: string; descripcion: string; cantidad: number;
  precioUnitario: number; descuentoPct: number; ivaPct: number;
}
export interface BorradorPedido {
  id: string; clienteId: string; bodegaId: string;
  canal: 'MOSTRADOR' | 'TELEFONO'; condicionPago: 'CONTADO' | 'CREDITO';
  lineas: LineaBorrador[];
}

export const nuevoId = () => uuidv7();

export async function guardarBorrador(b: BorradorPedido) {
  const subtotal = b.lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario * (1 - l.descuentoPct / 100), 0);
  await db.transaction('rw', db.pedidos, db.pedido_lineas, db.outbox, async () => {
    await db.pedidos.put({
      id: b.id, cliente_id: b.clienteId, bodega_id: b.bodegaId, canal: b.canal, condicion_pago: b.condicionPago,
      estado: 'BORRADOR', total: subtotal, creado_en: new Date().toISOString(), _local: true,
    });
    await db.pedido_lineas.where('pedido_id').equals(b.id).delete();
    await db.pedido_lineas.bulkPut(b.lineas.map(l => ({
      id: l.id, pedido_id: b.id, articulo_id: l.articuloId, descripcion: l.descripcion,
      cantidad: l.cantidad, precio_unitario: l.precioUnitario, descuento_pct: l.descuentoPct, iva_pct: l.ivaPct,
      cantidad_reservada: 0, cantidad_a_fabricar: 0,
    })));
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'pedidos.pedido.guardar_borrador', datos: b,
      registroId: b.id, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
}

export async function confirmarPedido(pedidoId: string) {
  await db.transaction('rw', db.pedidos, db.outbox, async () => {
    await db.pedidos.update(pedidoId, { _confirmando: true });   // marca visual "pendiente de confirmar"
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'pedidos.pedido.confirmar', datos: { pedidoId },
      registroId: pedidoId, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
}
