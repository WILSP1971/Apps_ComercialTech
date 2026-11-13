// src/lib/estados.ts — texto y color de cada estado, en un solo lugar
import type { Tono } from '@/componentes/ui';

type E = { texto: string; tono: Tono };
export const ESTADO_PEDIDO: Record<string, E> = {
  BORRADOR: { texto: 'Borrador', tono: 'gris' },
  PENDIENTE_APROBACION: { texto: 'Por aprobar', tono: 'ambar' },
  CONFIRMADO: { texto: 'Confirmado', tono: 'azul' },
  DESPACHADO: { texto: 'Despachado', tono: 'verde' },
  CANCELADO: { texto: 'Cancelado', tono: 'gris' },
  RECHAZADO: { texto: 'Rechazado', tono: 'rojo' },
};
export const ESTADO_FACTURA: Record<string, E> = {
  EMITIDA: { texto: 'Emitida', tono: 'azul' },
  PAGADA_PARCIAL: { texto: 'Pago parcial', tono: 'ambar' },
  PAGADA: { texto: 'Pagada', tono: 'verde' },
  ANULADA: { texto: 'Anulada', tono: 'gris' },
};
export const ESTADO_OF: Record<string, E> = {
  PLANIFICADA: { texto: 'Planificada', tono: 'gris' },
  LIBERADA: { texto: 'Liberada', tono: 'azul' },
  EN_PROCESO: { texto: 'En proceso', tono: 'violeta' },
  TERMINADA: { texto: 'Terminada', tono: 'verde' },
  CANCELADA: { texto: 'Cancelada', tono: 'gris' },
};
export const ESTADO_ORDEN_COMPRA: Record<string, E> = {
  BORRADOR: { texto: 'Borrador', tono: 'gris' },
  PENDIENTE_APROBACION: { texto: 'Por aprobar', tono: 'ambar' },
  APROBADA: { texto: 'Aprobada', tono: 'azul' },
  ENVIADA: { texto: 'Enviada', tono: 'violeta' },
  RECIBIDA_PARCIAL: { texto: 'Recibida parcial', tono: 'ambar' },
  RECIBIDA: { texto: 'Recibida', tono: 'verde' },
  CERRADA: { texto: 'Cerrada', tono: 'gris' },
  ANULADA: { texto: 'Anulada', tono: 'rojo' },
};
export const ESTADO_DESPACHO: Record<string, E> = {
  PROGRAMADO: { texto: 'Programado', tono: 'gris' },
  DESPACHADO: { texto: 'En ruta', tono: 'azul' },
  ENTREGADO: { texto: 'Entregado', tono: 'verde' },
  FALLIDO: { texto: 'Entrega fallida', tono: 'rojo' },
  CANCELADO: { texto: 'Cancelado', tono: 'gris' },
};
