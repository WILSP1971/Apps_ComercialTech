// src/modulos/sincronizacion/sincronizacion.controller.ts
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../infraestructura/auth';
import { BaseDatos } from '../../infraestructura/base-datos';
import { ErrorNegocio } from '../../kernel/errores';
import { RegistroComandosSync } from './registro-comandos';

const PushSchema = z.object({
  dispositivoId: z.string().uuid(),
  operaciones: z.array(z.object({
    idempotencyKey: z.string().uuid(), tipo: z.string(), datos: z.any(), creadoEn: z.string(),
  })).max(200),
});

// Qué tablas puede descargar cada rol. Un usuario con varios roles recibe la UNIÓN.
// (El cliente web no sincroniza: usa los endpoints /tienda.)
const TABLAS_POR_ROL: Record<string, string[]> = {
  vendedor: ['catalogo.articulo','catalogo.cliente','pedidos.cliente','pedidos.pedido','pedidos.pedido_linea',
             'inventarios.bodega','inventarios.existencia','caja.caja','caja.sesion_caja','caja.movimiento_caja','facturacion.factura'],
  supervisor_ventas: ['catalogo.articulo','catalogo.cliente','pedidos.cliente','pedidos.pedido','pedidos.pedido_linea','pedidos.aprobacion',
                      'inventarios.existencia'],
  bodeguero: ['catalogo.articulo','inventarios.bodega','inventarios.existencia','inventarios.conteo','inventarios.conteo_linea',
              'compras.proveedor','compras.orden_compra','compras.orden_compra_linea','compras.recepcion','compras.recepcion_linea',
              'pedidos.pedido','pedidos.pedido_linea','despacho.despacho','despacho.despacho_linea'],
  planificador_produccion: ['catalogo.articulo','inventarios.bodega','inventarios.existencia','pedidos.pedido_linea','fabricacion.orden_fabricacion'],
  cajero: ['catalogo.cliente','pedidos.cliente','pedidos.pedido','caja.caja','caja.sesion_caja','caja.movimiento_caja','caja.arqueo',
           'facturacion.factura','facturacion.pago_factura'],
  contador: ['catalogo.cliente','pedidos.cliente','pedidos.pedido','facturacion.factura','facturacion.factura_linea',
             'facturacion.pago_factura','facturacion.nota_credito','caja.caja','caja.sesion_caja','caja.movimiento_caja','caja.arqueo'],
  comprador: ['catalogo.articulo','inventarios.existencia','compras.proveedor','compras.orden_compra','compras.orden_compra_linea',
              'compras.recepcion','compras.recepcion_linea'],
  administrador: ['*'],
};

@Controller('sync')
@UseGuards(AuthGuard)
export class SincronizacionController {
  constructor(private readonly bd: BaseDatos, private readonly registro: RegistroComandosSync) {}

  @Post('push')
  async push(@Req() req: any, @Body() body: unknown) {
    const { dispositivoId, operaciones } = PushSchema.parse(body);
    const u = req.usuario;
    const resultados: any[] = [];

    // Se procesan EN ORDEN. Un rechazo de negocio no detiene el lote; un error técnico sí (se reintenta luego).
    for (const op of operaciones) {
      const [previo] = await this.bd.consultar(
        `SELECT resultado FROM sync.operacion_procesada WHERE idempotency_key = $1`, [op.idempotencyKey]);
      if (previo) { resultados.push(previo.resultado); continue; }

      const comando = this.registro.obtener(op.tipo);
      if (!comando) throw new BadRequestException(`Operación desconocida: ${op.tipo}`);

      let resultado: any;
      try {
        resultado = await this.bd.transaccion(async () => {
          const datos = await comando(u, op.datos, op.idempotencyKey);
          const r = { idempotencyKey: op.idempotencyKey, estado: 'OK', datos };
          await this.guardarProcesada(u.empresaId, dispositivoId, op, r);
          return r;
        });
      } catch (e) {
        if (e instanceof ErrorNegocio || (e as any)?.name === 'ZodError') {
          resultado = { idempotencyKey: op.idempotencyKey, estado: 'RECHAZADO',
                        codigo: (e as any).codigo ?? 'VALIDACION', mensaje: (e as Error).message };
          await this.guardarProcesada(u.empresaId, dispositivoId, op, resultado);
        } else throw e;
      }
      resultados.push(resultado);
    }
    await this.bd.consultar(
      `INSERT INTO sync.dispositivo (id, empresa_id, usuario_id, ultima_sync) VALUES ($1,$2,$3,now())
       ON CONFLICT (id) DO UPDATE SET ultima_sync = now()`, [dispositivoId, u.empresaId, u.id]);
    return { resultados };
  }

  @Get('pull')
  async pull(@Req() req: any, @Query('desde') desde = '0', @Query('limite') limite = '500') {
    const u = req.usuario;
    const lim = Math.min(Number(limite) || 500, 1000);
    const tablas = [...new Set((u.roles as string[]).flatMap(r => TABLAS_POR_ROL[r] ?? []))];
    const todas = tablas.includes('*');
    const filas = await this.bd.consultar(
      `SELECT secuencia, tabla, registro_id AS "registroId", operacion, version, payload
         FROM sync.cambios
        WHERE empresa_id = $1 AND secuencia > $2 AND ($3::boolean OR tabla = ANY($4::text[]))
        ORDER BY secuencia LIMIT $5`,
      [u.empresaId, Number(desde), todas, tablas, lim + 1]);
    const hayMas = filas.length > lim;
    const cambios = hayMas ? filas.slice(0, lim) : filas;
    const hasta = cambios.length ? Number(cambios[cambios.length - 1].secuencia) : Number(desde);
    return { cambios, hasta, hayMas };
  }

  private guardarProcesada(empresaId: string, dispositivoId: string, op: any, r: any) {
    return this.bd.consultar(
      `INSERT INTO sync.operacion_procesada (idempotency_key, empresa_id, dispositivo_id, tipo, resultado)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [op.idempotencyKey, empresaId, dispositivoId, op.tipo, JSON.stringify(r)]);
  }
}
