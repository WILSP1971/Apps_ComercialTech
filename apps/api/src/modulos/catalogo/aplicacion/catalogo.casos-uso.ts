import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';

const ClienteSchema = z.object({
  id: z.string().uuid(),
  tipoDocumento: z.enum(['CC', 'NIT', 'CE', 'PAS']),
  numeroDocumento: z.string().min(3),
  razonSocial: z.string().min(2),
  correo: z.string().email().optional(),
  telefono: z.string().optional(),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
  vendedorId: z.string().uuid().optional(),
});

const ArticuloSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().min(1),
  nombre: z.string().min(2),
  descripcion: z.string().optional(),
  unidadMedida: z.string().default('UND'),
  precioLista: z.number().nonnegative(),
  porcentajeIva: z.number().min(0).max(100).default(19),
  esFabricable: z.boolean().default(false),
  publicadoWeb: z.boolean().default(false),
});

@Injectable()
export class CatalogoCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}

  async guardarCliente(empresaId: string, entrada: unknown) {
    const d = ClienteSchema.parse(entrada);
    return this.bd.transaccion(async () => {
      const [previo] = await this.bd.consultar(`SELECT id FROM catalogo.cliente WHERE id=$1 AND empresa_id=$2`, [d.id, empresaId]);
      try {
        await this.bd.consultar(
          `INSERT INTO catalogo.cliente (id, empresa_id, tipo_documento, numero_documento, razon_social, correo, telefono, direccion, ciudad, vendedor_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET tipo_documento=$3, numero_documento=$4, razon_social=$5, correo=$6,
             telefono=$7, direccion=$8, ciudad=$9, vendedor_id=$10`,
          [d.id, empresaId, d.tipoDocumento, d.numeroDocumento, d.razonSocial, d.correo ?? null, d.telefono ?? null,
           d.direccion ?? null, d.ciudad ?? null, d.vendedorId ?? null]);
      } catch (e: any) {
        if (e.code === '23505') throw new ErrorNegocio('CLIENTE_DUPLICADO', 'Ya existe un cliente con ese documento');
        throw e;
      }
      // Pedidos mantiene su propio modelo de cliente (con el límite de crédito) a partir de este evento
      await this.eventos.publicar([{
        tipo: previo ? 'catalogo.ClienteActualizado' : 'catalogo.ClienteCreado',
        agregadoId: d.id, empresaId, ocurrioEn: new Date(),
        datos: { clienteId: d.id, numeroDocumento: d.numeroDocumento, razonSocial: d.razonSocial },
      }]);
      return {};
    });
  }

  async guardarArticulo(empresaId: string, entrada: unknown) {
    const d = ArticuloSchema.parse(entrada);
    try {
      await this.bd.consultar(
        `INSERT INTO catalogo.articulo (id, empresa_id, sku, nombre, descripcion, unidad_medida, precio_lista, porcentaje_iva, es_fabricable, publicado_web)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET sku=$3, nombre=$4, descripcion=$5, unidad_medida=$6, precio_lista=$7,
           porcentaje_iva=$8, es_fabricable=$9, publicado_web=$10`,
        [d.id, empresaId, d.sku, d.nombre, d.descripcion ?? null, d.unidadMedida, d.precioLista, d.porcentajeIva, d.esFabricable, d.publicadoWeb]);
    } catch (e: any) {
      if (e.code === '23505') throw new ErrorNegocio('SKU_DUPLICADO', 'Ya existe un artículo con ese SKU');
      throw e;
    }
    return {};
  }

  listarArticulos(empresaId: string, q?: string) {
    return this.bd.consultar(
      `SELECT * FROM catalogo.articulo WHERE empresa_id=$1 AND eliminado_en IS NULL AND activo
          AND ($2::text IS NULL OR nombre ILIKE '%' || $2 || '%' OR sku ILIKE '%' || $2 || '%')
        ORDER BY nombre LIMIT 200`, [empresaId, q ?? null]);
  }

  /** Catálogo del e-commerce: solo artículos publicados. */
  catalogoWeb(empresaId: string) {
    return this.bd.consultar(
      `SELECT id, sku, nombre, descripcion, unidad_medida, precio_lista, porcentaje_iva
         FROM catalogo.articulo
        WHERE empresa_id=$1 AND publicado_web AND activo AND eliminado_en IS NULL ORDER BY nombre`, [empresaId]);
  }
}
