// src/modulos/compras/infraestructura/proveedor.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Proveedor } from '../dominio/proveedor';
import { ProveedorRepositorio } from '../dominio/repositorios';

@Injectable()
export class ProveedorRepositorioPg implements ProveedorRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async obtener(id: string, empresaId: string): Promise<Proveedor | null> {
    const [p] = await this.bd.consultar(
      `SELECT * FROM compras.proveedor WHERE id=$1 AND empresa_id=$2 AND eliminado_en IS NULL`, [id, empresaId]);
    return p ? Proveedor.reconstituir({
      id: p.id, empresaId: p.empresa_id, nit: p.nit, razonSocial: p.razon_social, correo: p.correo,
      telefono: p.telefono, plazoDias: p.plazo_dias, activo: p.activo,
    }) : null;
  }

  async guardar(p: Proveedor): Promise<void> {
    const s = p.snapshot;
    await this.bd.consultar(
      `INSERT INTO compras.proveedor (id, empresa_id, nit, razon_social, correo, telefono, plazo_dias, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET nit=$3, razon_social=$4, correo=$5, telefono=$6, plazo_dias=$7, activo=$8`,
      [s.id, s.empresaId, s.nit, s.razonSocial, s.correo, s.telefono, s.plazoDias, s.activo]);
  }

  async tieneOrdenesAbiertas(id: string, empresaId: string): Promise<boolean> {
    const [r] = await this.bd.consultar(
      `SELECT count(*)::int AS n FROM compras.orden_compra
        WHERE proveedor_id=$1 AND empresa_id=$2 AND eliminado_en IS NULL
          AND estado IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','ENVIADA','RECIBIDA_PARCIAL')`, [id, empresaId]);
    return r.n > 0;
  }
}
