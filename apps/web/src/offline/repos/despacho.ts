// src/offline/repos/despacho.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

const ahora = () => new Date().toISOString();

/**
 * Bodeguero: despacha un pedido en un solo paso (programa + saca la mercadería). Funciona sin conexión;
 * R12 se valida en el servidor al sincronizar: si la reserva ya no está activa vuelve RECHAZADA con
 * R12_SIN_RESERVA_ACTIVA y el despacho local se marca para revisión.
 */
export async function despacharPedido(p: { pedidoId: string; transportador?: string; guia?: string; pedidoLineaIds?: string[] }) {
  const despachoId = uuidv7();
  await db.transaction('rw', db.despachos, db.outbox, async () => {
    await db.despachos.put({
      id: despachoId, pedido_id: p.pedidoId, estado: 'DESPACHADO', transportador: p.transportador ?? null, guia: p.guia ?? null,
      creado_en: ahora(), _pendiente: true,
    });
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'despacho.despacho.registrar',
      datos: { despachoId, pedidoId: p.pedidoId, transportador: p.transportador, guia: p.guia, pedidoLineaIds: p.pedidoLineaIds },
      registroId: despachoId, creadoEn: ahora(), estado: 'pendiente',
    });
  });
  solicitarSync();
  return despachoId;
}

/** Transportador/bodeguero: confirma la entrega con quien recibe (y evidencia si la hay). */
export async function registrarEntrega(p: { despachoId: string; receptor: string; evidenciaUrl?: string }) {
  await db.transaction('rw', db.despachos, db.outbox, async () => {
    await db.despachos.update(p.despachoId, { estado: 'ENTREGADO', receptor: p.receptor, entregado_en: ahora(), _pendiente: true });
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'despacho.despacho.entregar', datos: p,
      registroId: p.despachoId, creadoEn: ahora(), estado: 'pendiente',
    });
  });
  solicitarSync();
}

export async function registrarEntregaFallida(p: { despachoId: string; motivo: string }) {
  await db.transaction('rw', db.despachos, db.outbox, async () => {
    await db.despachos.update(p.despachoId, { estado: 'FALLIDO', motivo_fallo: p.motivo, _pendiente: true });
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'despacho.despacho.fallido', datos: p,
      registroId: p.despachoId, creadoEn: ahora(), estado: 'pendiente',
    });
  });
  solicitarSync();
}
