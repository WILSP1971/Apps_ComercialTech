import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { DespacharPedido } from '../aplicacion/despachar-pedido';

@Controller('despachos')
@UseGuards(AuthGuard)
export class DespachoController {
  constructor(private readonly despachar: DespacharPedido) {}

  @Post()
  @Permiso('despacho.despacho.gestionar')
  registrar(@Req() req: any, @Body() body: { despachoId: string; pedidoId: string; direccionEntrega: string }) {
    return this.despachar.ejecutar(req.usuario, body);
  }
}
