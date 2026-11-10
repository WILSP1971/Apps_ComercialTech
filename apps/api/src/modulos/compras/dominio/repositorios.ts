// src/modulos/compras/dominio/repositorios.ts   (puertos)
import { OrdenCompra } from './orden-compra';
import { Proveedor } from './proveedor';
import { DetalleRecepcion } from './orden-compra';

export const ORDEN_COMPRA_REPOSITORIO = Symbol('ORDEN_COMPRA_REPOSITORIO');
export interface OrdenCompraRepositorio {
  obtener(id: string, empresaId: string): Promise<OrdenCompra | null>;   // con bloqueo FOR UPDATE
  guardar(orden: OrdenCompra): Promise<void>;
  siguienteNumero(empresaId: string): Promise<string>;
}

export const PROVEEDOR_REPOSITORIO = Symbol('PROVEEDOR_REPOSITORIO');
export interface ProveedorRepositorio {
  obtener(id: string, empresaId: string): Promise<Proveedor | null>;
  guardar(p: Proveedor): Promise<void>;
  tieneOrdenesAbiertas(id: string, empresaId: string): Promise<boolean>;
}

export const RECEPCION_REPOSITORIO = Symbol('RECEPCION_REPOSITORIO');
export interface RecepcionRepositorio {
  existe(id: string, empresaId: string): Promise<boolean>;
  guardar(r: { id: string; empresaId: string; ordenId: string; recibidoPor: string; observaciones: string | null; detalle: DetalleRecepcion[] }): Promise<void>;
}
