// src/modulos/compras/aplicacion/compras.consultas.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';

const ESTADOS = ['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA', 'CERRADA', 'ANULADA'];

@Injectable()
export class ComprasConsultas {
  constructor(private readonly bd: BaseDatos) {}

  listarOrdenes(empresaId: string, f: { estado?: string; proveedorId?: string; limite?: number }) {
    const estado = f.estado && ESTADOS.includes(f.estado) ? f.estado : null;
    return this.bd.consultar(
      `SELECT o.id, o.numero, o.estado, o.total, o.proveedor_id, p.razon_social AS proveedor, o.bodega_id,
              o.fecha_esperada, o.creado_en
         FROM compras.orden_compra o JOIN compras.proveedor p ON p.id = o.proveedor_id
        WHERE o.empresa_id=$1 AND o.eliminado_en IS NULL
          AND ($2::text IS NULL OR o.estado = $2) AND ($3::uuid IS NULL OR o.proveedor_id = $3)
        ORDER BY o.creado_en DESC LIMIT $4`,
      [empresaId, estado, f.proveedorId ?? null, Math.min(f.limite ?? 100, 500)]);
  }

  async obtenerOrden(empresaId: string, id: string) {
    const [o] = await this.bd.consultar(
      `SELECT o.*, p.razon_social AS proveedor FROM compras.orden_compra o
         JOIN compras.proveedor p ON p.id = o.proveedor_id
        WHERE o.id=$1 AND o.empresa_id=$2 AND o.eliminado_en IS NULL`, [id, empresaId]);
    if (!o) return null;
    const lineas = await this.bd.consultar(
      `SELECT l.id, l.articulo_id, l.cantidad, l.cantidad_recibida, l.cantidad - l.cantidad_recibida AS pendiente, l.costo_unitario
         FROM compras.orden_compra_linea l WHERE l.orden_id=$1 AND l.eliminado_en IS NULL ORDER BY l.creado_en`, [id]);
    const recepciones = await this.bd.consultar(
      `SELECT r.id, r.recibido_por, r.observaciones, r.creado_en,
              (SELECT json_agg(json_build_object('ordenLineaId', rl.orden_linea_id, 'articuloId', rl.articulo_id, 'cantidad', rl.cantidad))
                 FROM compras.recepcion_linea rl WHERE rl.recepcion_id = r.id) AS lineas
         FROM compras.recepcion r WHERE r.orden_id=$1 ORDER BY r.creado_en`, [id]);
    return { ...o, lineas, recepciones };
  }

  /** Lo que el bodeguero espera recibir (vista compras.v_pendiente_recibir). */
  pendientesDeRecibir(empresaId: string, bodegaId?: string) {
    return this.bd.consultar(
      `SELECT orden_id, numero, proveedor_id, bodega_id, estado, orden_linea_id, articulo_id, cantidad, cantidad_recibida, pendiente
         FROM compras.v_pendiente_recibir
        WHERE empresa_id=$1 AND ($2::uuid IS NULL OR bodega_id=$2) ORDER BY numero, orden_linea_id`, [empresaId, bodegaId ?? null]);
  }

  listarProveedores(empresaId: string, q?: string, soloActivos = true) {
    return this.bd.consultar(
      `SELECT id, nit, razon_social, correo, telefono, plazo_dias, activo FROM compras.proveedor
        WHERE empresa_id=$1 AND eliminado_en IS NULL AND ($3::boolean = false OR activo)
          AND ($2::text IS NULL OR razon_social ILIKE '%' || $2 || '%' OR nit ILIKE '%' || $2 || '%')
        ORDER BY razon_social LIMIT 200`, [empresaId, q ?? null, soloActivos]);
  }
}
