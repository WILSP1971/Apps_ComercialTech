// src/modulos/pedidos/aplicacion/puertos.ts
export const INVENTARIOS_PUERTO = Symbol('INVENTARIOS_PUERTO');
export interface InventariosPuerto {
  /** Reserva el MENOR entre lo pedido y lo disponible. Idempotente por pedidoLineaId. */
  reservar(c: { empresaId: string; articuloId: string; bodegaId: string; cantidad: number;
                pedidoId: string; pedidoLineaId: string; usuarioId: string }): Promise<{ reservada: number }>;
}
