import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { CatalogoCasosUso } from '../aplicacion/catalogo.casos-uso';

@Controller()
@UseGuards(AuthGuard)
export class CatalogoController {
  constructor(private readonly casos: CatalogoCasosUso) {}

  @Get('catalogo/articulos')
  articulos(@Req() req: any, @Query('q') q?: string) { return this.casos.listarArticulos(req.usuario.empresaId, q); }

  @Post('catalogo/articulos')
  @Permiso('catalogo.articulo.gestionar')
  guardarArticulo(@Req() req: any, @Body() body: unknown) { return this.casos.guardarArticulo(req.usuario.empresaId, body); }

  @Post('catalogo/clientes')
  @Permiso('catalogo.cliente.gestionar')
  guardarCliente(@Req() req: any, @Body() body: unknown) { return this.casos.guardarCliente(req.usuario.empresaId, body); }

  // ---- E-commerce (cliente web) ----
  @Get('tienda/catalogo')
  @Permiso('tienda.catalogo.ver')
  catalogoWeb(@Req() req: any) { return this.casos.catalogoWeb(req.usuario.empresaId); }
}
