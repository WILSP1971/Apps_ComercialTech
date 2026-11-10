// src/modulos/compras/presentacion/compras.controller.ts
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ComprasConsultas } from '../aplicacion/compras.consultas';
import { GuardarBorradorOrdenCompra } from '../aplicacion/guardar-borrador-orden-compra';
import { RegistrarRecepcion } from '../aplicacion/registrar-recepcion';
import {
  AnularOrdenCompra, AprobarOrdenCompra, CerrarOrdenCompra, EnviarAAprobacionOrdenCompra, EnviarOrdenCompra,
} from '../aplicacion/transiciones-orden-compra';

@Controller('compras')
@UseGuards(AuthGuard)
export class ComprasController {
  constructor(
    private readonly consultas: ComprasConsultas,
    private readonly guardar: GuardarBorradorOrdenCompra,
    private readonly aEnviarAprobacion: EnviarAAprobacionOrdenCompra,
    private readonly aprobar: AprobarOrdenCompra,
    private readonly enviar: EnviarOrdenCompra,
    private readonly recepcion: RegistrarRecepcion,
    private readonly cerrar: CerrarOrdenCompra,
    private readonly anular: AnularOrdenCompra,
  ) {}

  // ---- Consultas ----
  @Get('ordenes')
  @Permiso('compras.orden.ver')
  ordenes(@Req() req: any, @Query('estado') estado?: string, @Query('proveedorId') proveedorId?: string, @Query('limite') limite?: string) {
    return this.consultas.listarOrdenes(req.usuario.empresaId, { estado, proveedorId, limite: limite ? Number(limite) : undefined });
  }

  @Get('pendientes-recibir')
  @Permiso('compras.orden.ver')
  pendientes(@Req() req: any, @Query('bodegaId') bodegaId?: string) {
    return this.consultas.pendientesDeRecibir(req.usuario.empresaId, bodegaId);
  }

  @Get('ordenes/:id')
  @Permiso('compras.orden.ver')
  async orden(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.consultas.obtenerOrden(req.usuario.empresaId, id);
    if (!o) throw new NotFoundException();
    return o;
  }

  // ---- Órdenes de compra ----
  @Post('ordenes')
  @Permiso('compras.orden.crear')
  guardarBorrador(@Req() req: any, @Body() body: unknown) { return this.guardar.ejecutar(req.usuario, body); }

  @Post('ordenes/:id/enviar-aprobacion')
  @Permiso('compras.orden.crear')
  enviarAprobacion(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.aEnviarAprobacion.ejecutar(req.usuario, id); }

  @Post('ordenes/:id/aprobar')
  @Permiso('compras.orden.aprobar')
  aprobarOrden(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.aprobar.ejecutar(req.usuario, id); }

  @Post('ordenes/:id/enviar')
  @Permiso('compras.orden.aprobar')
  enviarAlProveedor(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.enviar.ejecutar(req.usuario, id); }

  @Post('ordenes/:id/cerrar')
  @Permiso('compras.orden.aprobar')
  cerrarOrden(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.cerrar.ejecutar(req.usuario, id); }

  @Post('ordenes/:id/anular')
  @Permiso('compras.orden.aprobar')
  anularOrden(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.anular.ejecutar(req.usuario, id, body); }

  // ---- Recepción de mercadería (bodeguero) ----
  @Post('recepciones')
  @Permiso('compras.recepcion.registrar')
  recibir(@Req() req: any, @Body() body: unknown) { return this.recepcion.ejecutar(req.usuario, body); }
}
