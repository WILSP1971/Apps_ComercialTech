import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { CarteraConsultas } from '../aplicacion/cartera.consultas';
import { FacturacionCasosUso } from '../aplicacion/facturacion.casos-uso';

@Controller()
@UseGuards(AuthGuard)
export class FacturacionController {
  constructor(private readonly casos: FacturacionCasosUso, private readonly cartera: CarteraConsultas) {}

  @Post('facturas')
  @Permiso('facturacion.factura.emitir')
  emitir(@Req() req: any, @Body() body: { facturaId: string; pedidoId: string; prefijo: string }) {
    return this.casos.emitir(req.usuario, body);
  }

  @Post('facturas/:id/anular')
  @Permiso('facturacion.factura.anular')
  anular(@Req() req: any, @Param('id', ParseUUIDPipe) id: string,
         @Body() body: { notaId: string; prefijoNc: string; motivo: string }) {
    return this.casos.anular(req.usuario, { ...body, facturaId: id });
  }

  @Get('cartera')
  @Permiso('facturacion.cartera.ver')
  carteraPendiente(@Req() req: any, @Query('vencida') vencida?: string) {
    return this.cartera.pendiente(req.usuario.empresaId, vencida === 'true');
  }
}
