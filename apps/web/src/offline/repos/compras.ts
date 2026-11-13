// src/offline/repos/compras.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

const ahora = () => new Date().toISOString();

export interface ProveedorEntrada { id: string; nit: string; razonSocial: string; correo?: string; telefono?: string; plazoDias: number }
export interface LineaOrdenEntrada { id: string; articuloId: string; cantidad: number; costoUnitario: number }
export interface OrdenEntrada {
  id: string; proveedorId: string; bodegaId: string; fechaEsperada?: string; observaciones?: string; lineas: LineaOrdenEntrada[];
}

export const nuevoId = () => uuidv7();

export async function guardarProveedor(p: ProveedorEntrada) {
  await db.transaction('rw', db.proveedores, db.outbox, async () => {
    await db.proveedores.put({
      id: p.id, nit: p.nit, razon_social: p.razonSocial, correo: p.correo ?? null, telefono: p.telefono ?? null,
      plazo_dias: p.plazoDias, activo: true, _pendiente: true,
    });
    await db.outbox.add({ idempotencyKey: uuidv7(), tipo: 'compras.proveedor.guardar', datos: p, registroId: p.id, creadoEn: ahora(), estado: 'pendiente' });
  });
  solicitarSync();
}

/** El comprador puede dejar el borrador sin conexión; aprobar y enviar exigen conexión (reglas del servidor). */
export async function guardarBorradorOrden(o: OrdenEntrada) {
  const total = o.lineas.reduce((s, l) => s + l.cantidad * l.costoUnitario, 0);
  await db.transaction('rw', db.ordenes_compra, db.orden_compra_lineas, db.outbox, async () => {
    await db.ordenes_compra.put({
      id: o.id, proveedor_id: o.proveedorId, bodega_id: o.bodegaId, estado: 'BORRADOR', total,
      fecha_esperada: o.fechaEsperada ?? null, creado_en: ahora(), _pendiente: true,
    });
    await db.orden_compra_lineas.where('orden_id').equals(o.id).delete();
    await db.orden_compra_lineas.bulkPut(o.lineas.map(l => ({
      id: l.id, orden_id: o.id, articulo_id: l.articuloId, cantidad: l.cantidad, cantidad_recibida: 0, costo_unitario: l.costoUnitario,
    })));
    await db.outbox.add({ idempotencyKey: uuidv7(), tipo: 'compras.orden.guardar_borrador', datos: o, registroId: o.id, creadoEn: ahora(), estado: 'pendiente' });
  });
  solicitarSync();
}

/**
 * Recepción de mercadería en bodega (también sin conexión). El servidor valida que no se reciba más de lo
 * pendiente; si la orden ya no admite recepciones, la operación vuelve RECHAZADA con el motivo.
 */
export async function registrarRecepcion(p: { ordenId: string; observaciones?: string; lineas: { ordenLineaId: string; cantidad: number }[] }) {
  const recepcionId = uuidv7();
  await db.transaction('rw', db.recepciones, db.recepcion_lineas, db.outbox, async () => {
    await db.recepciones.put({ id: recepcionId, orden_id: p.ordenId, observaciones: p.observaciones ?? null, creado_en: ahora(), _pendiente: true });
    await db.recepcion_lineas.bulkPut(p.lineas.map(l => ({ id: uuidv7(), recepcion_id: recepcionId, orden_linea_id: l.ordenLineaId, cantidad: l.cantidad })));
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'compras.recepcion.registrar',
      datos: { recepcionId, ordenId: p.ordenId, observaciones: p.observaciones, lineas: p.lineas },
      registroId: recepcionId, creadoEn: ahora(), estado: 'pendiente',
    });
  });
  solicitarSync();
  return recepcionId;
}
