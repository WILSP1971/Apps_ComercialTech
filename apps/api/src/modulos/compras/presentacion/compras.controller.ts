import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ComprasCasosUso } from '../aplicacion/compras.casos-uso';

@Controller('compras')
@UseGuards(AuthGuard)
export class ComprasController {
  constructor(private readonly casos: ComprasCasosUso) {}

  @Post('ordenes')
  @Permiso('compras.orden.crear')
  guardar(@Req() req: any, @Body() body: unknown) { return this.casos.guardarBorrador(req.usuario, body); }

  @Post('ordenes/:id/aprobar')
  @Permiso('compras.orden.aprobar')
  aprobar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.casos.aprobar(req.usuario, id); }

  @Post('ordenes/:id/cerrar')
  @Permiso('compras.orden.aprobar')
  cerrar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.casos.cerrar(req.usuario, id); }

  @Post('recepciones')
  @Permiso('compras.recepcion.registrar')
  recibir(@Req() req: any, @Body() body: any) { return this.casos.registrarRecepcion(req.usuario, body); }
}
