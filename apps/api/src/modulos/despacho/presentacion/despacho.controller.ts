// src/modulos/despacho/presentacion/despacho.controller.ts
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { DespacharPedido } from '../aplicacion/despachar-pedido';
import { DespachoConsultas } from '../aplicacion/despacho.consultas';
import { ProgramarDespacho } from '../aplicacion/programar-despacho';
import {
  ActualizarLogisticaDespacho, CancelarDespacho, RegistrarEntrega, RegistrarEntregaFallida, ReintentarEntrega,
} from '../aplicacion/transiciones-despacho';

@Controller('despachos')
@UseGuards(AuthGuard)
export class DespachoController {
  constructor(
    private readonly consultas: DespachoConsultas,
    private readonly programar: ProgramarDespacho,
    private readonly despachar: DespacharPedido,
    private readonly entrega: RegistrarEntrega,
    private readonly fallida: RegistrarEntregaFallida,
    private readonly reintentar: ReintentarEntrega,
    private readonly cancelar: CancelarDespacho,
    private readonly logistica: ActualizarLogisticaDespacho,
  ) {}

  @Get()
  @Permiso('despacho.despacho.ver')
  listar(@Req() req: any, @Query('estado') estado?: string, @Query('pedidoId') pedidoId?: string, @Query('limite') limite?: string) {
    return this.consultas.listar(req.usuario.empresaId, { estado, pedidoId, limite: limite ? Number(limite) : undefined });
  }

  @Get('listos')
  @Permiso('despacho.despacho.ver')
  listos(@Req() req: any, @Query('bodegaId') bodegaId?: string) { return this.consultas.listosParaDespachar(req.usuario.empresaId, bodegaId); }

  @Get(':id')
  @Permiso('despacho.despacho.ver')
  async uno(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.consultas.obtener(req.usuario.empresaId, id);
    if (!d) throw new NotFoundException();
    return d;
  }

  /** Programar sin sacar la mercadería todavía. */
  @Post('programar')
  @Permiso('despacho.despacho.gestionar')
  async programarDespacho(@Req() req: any, @Body() body: unknown) {
    const d = await this.programar.ejecutar(req.usuario, body);
    return { despachoId: d.id, numero: d.numero, estado: d.estado };
  }

  /** Despachar (programa y despacha en un paso si no existía). R12 se valida aquí. */
  @Post()
  @Permiso('despacho.despacho.gestionar')
  registrar(@Req() req: any, @Body() body: unknown) { return this.despachar.ejecutar(req.usuario, body); }

  @Post(':id/entregar')
  @Permiso('despacho.despacho.gestionar')
  entregar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.entrega.ejecutar(req.usuario, { ...body, despachoId: id }); }

  @Post(':id/fallido')
  @Permiso('despacho.despacho.gestionar')
  entregaFallida(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.fallida.ejecutar(req.usuario, { ...body, despachoId: id }); }

  @Post(':id/reintentar')
  @Permiso('despacho.despacho.gestionar')
  reintentarEntrega(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) { return this.reintentar.ejecutar(req.usuario, { despachoId: id }); }

  @Post(':id/cancelar')
  @Permiso('despacho.despacho.gestionar')
  cancelarDespacho(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.cancelar.ejecutar(req.usuario, { ...body, despachoId: id }); }

  @Post(':id/logistica')
  @Permiso('despacho.despacho.gestionar')
  actualizarLogistica(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) { return this.logistica.ejecutar(req.usuario, { ...body, despachoId: id }); }
}
