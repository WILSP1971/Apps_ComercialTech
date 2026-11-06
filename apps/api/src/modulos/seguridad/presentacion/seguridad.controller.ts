import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { SeguridadCasosUso } from '../aplicacion/seguridad.casos-uso';

@Controller('seguridad')
@UseGuards(AuthGuard)
export class SeguridadController {
  constructor(private readonly casos: SeguridadCasosUso) {}

  /** Datos del usuario autenticado (roles y permisos): la PWA los usa para mostrar el menú. */
  @Get('yo')
  yo(@Req() req: any) { return req.usuario; }

  @Get('usuarios')
  @Permiso('seguridad.usuario.gestionar')
  usuarios(@Req() req: any) { return this.casos.listarUsuarios(req.usuario.empresaId); }

  @Post('usuarios')
  @Permiso('seguridad.usuario.gestionar')
  guardar(@Req() req: any, @Body() body: unknown) { return this.casos.guardarUsuario(req.usuario.empresaId, body); }
}
