// src/offline/repos/fabricacion.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

const ahora = () => new Date().toISOString();

/** Planificador: libera una OF planificada. Funciona sin conexión; el servidor confirma al sincronizar. */
export async function liberarOrden(ordenId: string) {
  await db.transaction('rw', db.ordenes_fabricacion, db.outbox, async () => {
    await db.ordenes_fabricacion.update(ordenId, { estado: 'LIBERADA', _pendiente: true });
    await db.outbox.add({ idempotencyKey: uuidv7(), tipo: 'fabricacion.orden.liberar', datos: { ordenId }, registroId: ordenId, creadoEn: ahora(), estado: 'pendiente' });
  });
  void solicitarSync();
}

/** Reporta cantidad producida. Cada reporte es idempotente por su clave; al completar la cantidad la OF queda terminada. */
export async function reportarProduccion(ordenId: string, cantidad: number) {
  await db.transaction('rw', db.ordenes_fabricacion, db.outbox, async () => {
    const o = await db.ordenes_fabricacion.get(ordenId);
    if (!o) throw new Error('La orden no está en este dispositivo');
    const producida = Number(o.cantidad_producida) + cantidad;
    await db.ordenes_fabricacion.update(ordenId, {
      cantidad_producida: producida, estado: producida >= Number(o.cantidad) ? 'TERMINADA' : 'EN_PROCESO', _pendiente: true,
    });
    await db.outbox.add({ idempotencyKey: uuidv7(), tipo: 'fabricacion.orden.reportar', datos: { ordenId, cantidad }, registroId: ordenId, creadoEn: ahora(), estado: 'pendiente' });
  });
  void solicitarSync();
}
