import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ConfirmarPedido } from '../aplicacion/confirmar-pedido';
import { GuardarBorradorPedido } from '../aplicacion/guardar-borrador-pedido';
import { SeguimientoPedido } from '../aplicacion/seguimiento-pedido';

/** Canal e-commerce. No usa sincronización: es 100 % en línea. */
@Controller('tienda')
@UseGuards(AuthGuard)
export class TiendaController {
  constructor(
    private readonly guardar: GuardarBorradorPedido,
    private readonly confirmar: ConfirmarPedido,
    private readonly seguimiento: SeguimientoPedido,
  ) {}

  @Post('checkout')
  @Permiso('tienda.checkout.crear')
  async checkout(@Req() req: any, @Body() body: any) {
    const u = req.usuario;
    if (!u.clienteId) throw new ForbiddenException('El usuario no está asociado a un cliente');
    // canal, condición de pago y cliente los fija el servidor: el cuerpo no puede cambiarlos
    await this.guardar.ejecutar(u.empresaId, u.id, { ...body, clienteId: u.clienteId, canal: 'WEB', condicionPago: 'CONTADO' });
    return this.confirmar.ejecutar({ empresaId: u.empresaId, pedidoId: body.id, usuarioId: u.id });
  }

  @Get('pedidos/:id')
  @Permiso('tienda.pedido.seguimiento')
  async pedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.usuario;
    if (!u.clienteId) throw new ForbiddenException();
    const p = await this.seguimiento.obtener(u.empresaId, u.clienteId, id);
    if (!p) throw new NotFoundException();
    return p;
  }
}
