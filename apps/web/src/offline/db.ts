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
  // Compras y Despacho
  proveedores!: Table<any, string>;
  ordenes_compra!: Table<any, string>;
  orden_compra_lineas!: Table<any, string>;
  recepciones!: Table<any, string>;
  recepcion_lineas!: Table<any, string>;
  despachos!: Table<any, string>;
  despacho_lineas!: Table<any, string>;
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
    // v2: módulos Compras y Despacho (las tablas anteriores no cambian)
    this.version(2).stores({
      proveedores: 'id, nit, razon_social',
      ordenes_compra: 'id, estado, proveedor_id, creado_en',
      orden_compra_lineas: 'id, orden_id',
      recepciones: 'id, orden_id, creado_en',
      recepcion_lineas: 'id, recepcion_id',
      despachos: 'id, estado, pedido_id, creado_en',
      despacho_lineas: 'id, despacho_id, pedido_linea_id',
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
  'compras.proveedor': 'proveedores',
  'compras.orden_compra': 'ordenes_compra',
  'compras.orden_compra_linea': 'orden_compra_lineas',
  'compras.recepcion': 'recepciones',
  'compras.recepcion_linea': 'recepcion_lineas',
  'despacho.despacho': 'despachos',
  'despacho.despacho_linea': 'despacho_lineas',
};
