// src/offline/repos/caja.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';
import { api } from '../api';

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

/**
 * Cobro con tarjeta, transferencia o cheque: SIEMPRE en línea (R10). Se envía solo el token o código de
 * autorización de la pasarela; el servidor y la base de datos rechazan un número de tarjeta.
 */
export async function cobrarEnLinea(p: { sesionId: string; medioPago: 'TARJETA' | 'TRANSFERENCIA' | 'CHEQUE'; valor: number; referencia?: string; pedidoId?: string; facturaId?: string }) {
  const id = uuidv7();
  await api('/caja/cobros', {
    method: 'POST', headers: { 'Idempotency-Key': id },
    body: JSON.stringify({ id, sesionId: p.sesionId, medioPago: p.medioPago, valor: p.valor, referencia: p.referencia || undefined, pedidoId: p.pedidoId, facturaId: p.facturaId }),
  });
  void solicitarSync();
  return id;
}
