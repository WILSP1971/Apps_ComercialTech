// src/offline/db.ts
import Dexie, { Table } from 'dexie';

export type EstadoOperacion = 'pendiente' | 'rechazada';

export interface Operacion {
  idempotencyKey: string;
  tipo: string;                 // 'pedidos.pedido.guardar_borrador'
  datos: unknown;
  registroId: string;           // para no pisar registros con cambios locales pendientes
  creadoEn: string;
  estado: EstadoOperacion;
  error?: string;               // mensaje/código devuelto por el servidor (ej. R12_SIN_RESERVA_ACTIVA)
}

class BdLocal extends Dexie {
  // Datos maestros
  articulos!: Table<any, string>;
  clientes!: Table<any, string>;
  clientes_credito!: Table<any, string>;
  // Pedidos
  pedidos!: Table<any, string>;
  pedido_lineas!: Table<any, string>;
  // Inventarios / Fabricación (solo lectura en el cliente)
  bodegas!: Table<any, string>;
  existencias!: Table<any, string>;
  ordenes_fabricacion!: Table<any, string>;
  // Caja y Facturación
  cajas!: Table<any, string>;
  sesiones_caja!: Table<any, string>;
  movimientos_caja!: Table<any, string>;
  facturas!: Table<any, string>;
  // Infraestructura offline
  outbox!: Table<Operacion, string>;
  meta!: Table<{ clave: string; valor: unknown }, string>;

  constructor() {
    super('sierrainnova');
    this.version(1).stores({
      articulos: 'id, sku, nombre',
      clientes: 'id, razon_social, numero_documento',
      clientes_credito: 'id',
      pedidos: 'id, estado, cliente_id, creado_en',
      pedido_lineas: 'id, pedido_id',
      bodegas: 'id, codigo',
      existencias: 'id, [articulo_id+bodega_id]',
      ordenes_fabricacion: 'id, estado, pedido_linea_id',
      cajas: 'id',
      sesiones_caja: 'id, estado, usuario_id',
      movimientos_caja: 'id, sesion_id, creado_en',
      facturas: 'id, pedido_id, cliente_id, estado',
      outbox: 'idempotencyKey, estado, creadoEn',
      meta: 'clave',
    });
  }
}
export const db = new BdLocal();

// Correspondencia tabla del servidor -> tabla local
export const TABLAS_LOCALES: Record<string, keyof BdLocal & string> = {
  'catalogo.articulo': 'articulos',
  'catalogo.cliente': 'clientes',
  'pedidos.cliente': 'clientes_credito',
  'pedidos.pedido': 'pedidos',
  'pedidos.pedido_linea': 'pedido_lineas',
  'inventarios.bodega': 'bodegas',
  'inventarios.existencia': 'existencias',
  'fabricacion.orden_fabricacion': 'ordenes_fabricacion',
  'caja.caja': 'cajas',
  'caja.sesion_caja': 'sesiones_caja',
  'caja.movimiento_caja': 'movimientos_caja',
  'facturacion.factura': 'facturas',
};
