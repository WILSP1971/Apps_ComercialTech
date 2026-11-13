// src/modulos/compras/presentacion/proveedores.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ComprasConsultas } from '../aplicacion/compras.consultas';
import { CambiarEstadoProveedor, GuardarProveedor } from '../aplicacion/guardar-proveedor';

@Controller('compras/proveedores')
@UseGuards(AuthGuard)
export class ProveedoresController {
  constructor(
    private readonly consultas: ComprasConsultas,
    private readonly guardar: GuardarProveedor,
    private readonly estado: CambiarEstadoProveedor,
  ) {}

  @Get()
  @Permiso('compras.orden.ver')
  listar(@Req() req: any, @Query('q') q?: string, @Query('todos') todos?: string) {
    return this.consultas.listarProveedores(req.usuario.empresaId, q, todos !== 'true');
  }

  @Post()
  @Permiso('compras.proveedor.gestionar')
  guardarProveedor(@Req() req: any, @Body() body: unknown) { return this.guardar.ejecutar(req.usuario, body); }

  @Post(':id/desactivar')
  @Permiso('compras.proveedor.gestionar')
  desactivar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.estado.desactivar(req.usuario, id); }

  @Post(':id/activar')
  @Permiso('compras.proveedor.gestionar')
  activar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.estado.activar(req.usuario, id); }
}
