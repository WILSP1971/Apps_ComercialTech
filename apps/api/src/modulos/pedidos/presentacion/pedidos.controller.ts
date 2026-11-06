// src/modulos/pedidos/presentacion/pedidos.controller.ts
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ConfirmarPedido } from '../aplicacion/confirmar-pedido';
import { AprobarPedido } from '../aplicacion/aprobar-pedido';
import { GuardarBorradorPedido } from '../aplicacion/guardar-borrador-pedido';
import { CancelarPedido } from '../aplicacion/cancelar-pedido';

@Controller('pedidos')
@UseGuards(AuthGuard)
export class PedidosController {
  constructor(
    private readonly confirmar: ConfirmarPedido,
    private readonly aprobar: AprobarPedido,
    private readonly guardar: GuardarBorradorPedido,
    private readonly cancelar: CancelarPedido,
  ) {}

  @Post()
  @Permiso('pedidos.pedido.crear')
  async crear(@Req() req: any, @Body() body: unknown) {
    await this.guardar.ejecutar(req.usuario.empresaId, req.usuario.id, body);
    return { ok: true };
  }

  @Post(':id/confirmar')
  @Permiso('pedidos.pedido.confirmar')
  confirmarPedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.confirmar.ejecutar({ empresaId: req.usuario.empresaId, pedidoId: id, usuarioId: req.usuario.id });
  }

  @Post(':id/aprobar')                       // Supervisor de ventas (R13)
  @Permiso('pedidos.pedido.aprobar')
  aprobarPedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.aprobar.ejecutar({ empresaId: req.usuario.empresaId, pedidoId: id, usuarioId: req.usuario.id });
  }

  @Post(':id/cancelar')                      // Supervisor de ventas
  @Permiso('pedidos.pedido.cancelar')
  cancelarPedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.cancelar.ejecutar({ empresaId: req.usuario.empresaId, pedidoId: id });
  }
}
