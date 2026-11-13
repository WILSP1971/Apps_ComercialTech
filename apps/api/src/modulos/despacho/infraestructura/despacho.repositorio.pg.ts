// src/modulos/despacho/infraestructura/despacho.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Despacho } from '../dominio/despacho';
import { DespachoRepositorio } from '../dominio/repositorio';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class DespachoRepositorioPg implements DespachoRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async obtener(id: string, empresaId: string): Promise<Despacho | null> {
    const [d] = await this.bd.consultar(
      `SELECT d.*, to_char(d.fecha_programada, 'YYYY-MM-DD') AS fecha_programada_txt
         FROM despacho.despacho d WHERE d.id=$1 AND d.empresa_id=$2 AND d.eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    if (!d) return null;
    const lineas = await this.bd.consultar(
      `SELECT * FROM despacho.despacho_linea WHERE despacho_id=$1 AND eliminado_en IS NULL ORDER BY creado_en, id`, [id]);
    return Despacho.reconstituir({
      id: d.id, empresaId: d.empresa_id, pedidoId: d.pedido_id, clienteId: d.cliente_id, bodegaId: d.bodega_id,
      numero: d.numero, direccionEntrega: d.direccion_entrega, estado: d.estado,
      transportador: d.transportador, guia: d.guia, fechaProgramada: d.fecha_programada_txt,
      despachadoPor: d.despachado_por, despachadoEn: iso(d.despachado_en), entregadoEn: iso(d.entregado_en),
      receptor: d.receptor, evidenciaUrl: d.evidencia_url, motivoFallo: d.motivo_fallo,
      intentosEntrega: d.intentos_entrega, version: d.version,
      lineas: lineas.map((l: any) => ({
        id: l.id, pedidoLineaId: l.pedido_linea_id, articuloId: l.articulo_id, cantidad: Number(l.cantidad), reservaId: l.reserva_id,
      })),
    });
  }

  async guardar(d: Despacho): Promise<void> {
    const s = d.snapshot;
    await this.bd.consultar(
      `INSERT INTO despacho.despacho
         (id, empresa_id, numero, pedido_id, cliente_id, bodega_id, direccion_entrega, estado, transportador, guia,
          fecha_programada, despachado_por, despachado_en, entregado_en, receptor, evidencia_url, motivo_fallo, intentos_entrega)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET numero=$3, direccion_entrega=$7, estado=$8, transportador=$9, guia=$10, fecha_programada=$11,
         despachado_por=$12, despachado_en=$13, entregado_en=$14, receptor=$15, evidencia_url=$16, motivo_fallo=$17, intentos_entrega=$18`,
      [s.id, s.empresaId, s.numero, s.pedidoId, s.clienteId, s.bodegaId, s.direccionEntrega, s.estado, s.transportador, s.guia,
       s.fechaProgramada, s.despachadoPor, s.despachadoEn, s.entregadoEn, s.receptor, s.evidenciaUrl, s.motivoFallo, s.intentosEntrega]);

    if (s.estado === 'CANCELADO') {
      // Borrado lógico de las líneas: libera la unicidad de la reserva (ux_despacho_linea_reserva)
      await this.bd.consultar(`UPDATE despacho.despacho_linea SET eliminado_en = now() WHERE despacho_id=$1 AND eliminado_en IS NULL`, [s.id]);
      return;
    }
    for (const l of s.lineas) {
      await this.bd.consultar(
        `INSERT INTO despacho.despacho_linea (id, empresa_id, despacho_id, pedido_linea_id, articulo_id, cantidad, reserva_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [l.id, s.empresaId, s.id, l.pedidoLineaId, l.articuloId, l.cantidad, l.reservaId]);
    }
  }

  async siguienteNumero(empresaId: string): Promise<string> {
    const [r] = await this.bd.consultar(
      `INSERT INTO despacho.consecutivo (empresa_id, serie, ultimo) VALUES ($1,'DES',1)
       ON CONFLICT (empresa_id, serie) DO UPDATE SET ultimo = despacho.consecutivo.ultimo + 1
       RETURNING ultimo`, [empresaId]);
    return `DES-${String(r.ultimo).padStart(8, '0')}`;
  }

  async reservasAsignadas(empresaId: string, pedidoId: string): Promise<Set<string>> {
    const r = await this.bd.consultar(
      `SELECT l.reserva_id FROM despacho.despacho_linea l JOIN despacho.despacho d ON d.id = l.despacho_id
        WHERE d.empresa_id=$1 AND d.pedido_id=$2 AND l.eliminado_en IS NULL AND d.eliminado_en IS NULL AND d.estado <> 'CANCELADO'`,
      [empresaId, pedidoId]);
    return new Set(r.map((x: any) => x.reserva_id));
  }

  async despachadoPorLinea(empresaId: string, pedidoId: string): Promise<Map<string, number>> {
    const r = await this.bd.consultar(
      `SELECT l.pedido_linea_id, sum(l.cantidad) AS cantidad
         FROM despacho.despacho_linea l JOIN despacho.despacho d ON d.id = l.despacho_id
        WHERE d.empresa_id=$1 AND d.pedido_id=$2 AND l.eliminado_en IS NULL AND d.estado IN ('DESPACHADO','ENTREGADO','FALLIDO')
        GROUP BY l.pedido_linea_id`, [empresaId, pedidoId]);
    return new Map(r.map((x: any) => [x.pedido_linea_id, Number(x.cantidad)]));
  }
}
