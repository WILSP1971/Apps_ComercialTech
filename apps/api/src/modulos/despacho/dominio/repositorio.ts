// src/modulos/despacho/dominio/repositorio.ts   (puerto)
import { Despacho } from './despacho';

export const DESPACHO_REPOSITORIO = Symbol('DESPACHO_REPOSITORIO');
export interface DespachoRepositorio {
  obtener(id: string, empresaId: string): Promise<Despacho | null>;      // con bloqueo FOR UPDATE
  guardar(d: Despacho): Promise<void>;
  siguienteNumero(empresaId: string): Promise<string>;
  /** Reservas del pedido que ya están asignadas a un despacho vigente (programado o despachado). */
  reservasAsignadas(empresaId: string, pedidoId: string): Promise<Set<string>>;
  /** Cantidad ya despachada (despachos DESPACHADO/ENTREGADO/FALLIDO) por línea de pedido. */
  despachadoPorLinea(empresaId: string, pedidoId: string): Promise<Map<string, number>>;
}

export const INVENTARIOS_DESPACHO_PUERTO = Symbol('INVENTARIOS_DESPACHO_PUERTO');
export interface InventariosDespachoPuerto {
  reservasActivas(empresaId: string, pedidoId: string): Promise<{ id: string; pedidoLineaId: string; articuloId: string; cantidad: number }[]>;
  /** R12: consume las reservas y asienta la SALIDA_DESPACHO en el kardex. Falla si alguna no está ACTIVA. */
  consumirReservas(c: { empresaId: string; reservaIds: string[]; despachoId: string; usuarioId: string }): Promise<void>;
}

export const PEDIDOS_DESPACHO_PUERTO = Symbol('PEDIDOS_DESPACHO_PUERTO');
export interface PedidosDespachoPuerto {
  obtener(empresaId: string, pedidoId: string): Promise<{
    pedidoId: string; numero: string | null; clienteId: string; bodegaId: string; estado: string; direccionEntrega: string | null;
    lineas: { id: string; articuloId: string; descripcion: string; cantidad: number }[];
  } | null>;
}
