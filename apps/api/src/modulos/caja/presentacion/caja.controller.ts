import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { CajaCasosUso } from '../aplicacion/caja.casos-uso';
import { CerrarSesionCaja } from '../aplicacion/cerrar-sesion';

@Controller('caja')
@UseGuards(AuthGuard)
export class CajaController {
  constructor(private readonly caja: CajaCasosUso, private readonly cierre: CerrarSesionCaja) {}

  @Post('sesiones')
  @Permiso('caja.sesion.abrir')
  abrir(@Req() req: any, @Body() body: { id: string; cajaId: string; montoApertura: number }) {
    return this.caja.abrirSesion(req.usuario, body);
  }

  @Post('sesiones/:id/cerrar')
  @Permiso('caja.sesion.cerrar')
  cerrar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.cierre.ejecutar(req.usuario, { ...body, sesionId: id });
  }

  /** Cobro en línea (tarjeta con token de la pasarela, R10). Offline se usa el comando de sincronización. */
  @Post('cobros')
  @Permiso('caja.cobro.registrar')
  cobrar(@Req() req: any, @Body() body: any) {
    return this.caja.registrarCobro(req.usuario, body, req.headers['idempotency-key'] ?? body.id);
  }

  @Post('movimientos/:id/reversar')
  @Permiso('caja.movimiento.reversar')
  reversar(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() body: { id: string; motivo: string }) {
    return this.caja.reversar(req.usuario, { id: body.id, movimientoId: id, motivo: body.motivo });
  }
}
