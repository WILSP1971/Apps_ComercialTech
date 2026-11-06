// src/offline/repos/caja.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

/** Cobro en efectivo/transferencia dentro de una sesión YA abierta (abrirla exige conexión: R8). */
export async function registrarCobroEfectivo(p: { sesionId: string; valor: number; pedidoId?: string; facturaId?: string }) {
  const sesion = await db.sesiones_caja.get(p.sesionId);
  if (!sesion || sesion.estado !== 'ABIERTA') throw new Error('No hay una sesión de caja abierta en este dispositivo');

  const id = uuidv7();
  await db.transaction('rw', db.movimientos_caja, db.outbox, async () => {
    await db.movimientos_caja.put({                       // R9: solo se inserta, nunca se edita ni se borra
      id, sesion_id: p.sesionId, tipo: 'COBRO', sentido: 'ENTRADA', medio_pago: 'EFECTIVO',
      valor: p.valor, pedido_id: p.pedidoId ?? null, factura_id: p.facturaId ?? null,
      creado_en: new Date().toISOString(), _pendiente: true,
    });
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'caja.cobro.registrar',
      datos: { id, sesionId: p.sesionId, medioPago: 'EFECTIVO', valor: p.valor, pedidoId: p.pedidoId, facturaId: p.facturaId },
      registroId: id, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
  return id;
}
// Pagos con TARJETA: NO se encolan. Se llama en línea a la pasarela, se obtiene el token/autorización y
// solo entonces se envía el cobro (R10). Una corrección es un REVERSO en línea (R9), nunca una edición.
