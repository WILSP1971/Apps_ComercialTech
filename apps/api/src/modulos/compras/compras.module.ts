// src/modulos/compras/compras.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { RegistroComandosSync } from '../sincronizacion';
import { ComprasConsultas } from './aplicacion/compras.consultas';
import { GuardarBorradorOrdenCompra } from './aplicacion/guardar-borrador-orden-compra';
import { CambiarEstadoProveedor, GuardarProveedor } from './aplicacion/guardar-proveedor';
import { RegistrarRecepcion } from './aplicacion/registrar-recepcion';
import {
  AnularOrdenCompra, AprobarOrdenCompra, CerrarOrdenCompra, EnviarAAprobacionOrdenCompra, EnviarOrdenCompra,
} from './aplicacion/transiciones-orden-compra';
import { ORDEN_COMPRA_REPOSITORIO, PROVEEDOR_REPOSITORIO, RECEPCION_REPOSITORIO } from './dominio/repositorios';
import { OrdenCompraRepositorioPg } from './infraestructura/orden-compra.repositorio.pg';
import { ProveedorRepositorioPg } from './infraestructura/proveedor.repositorio.pg';
import { RecepcionRepositorioPg } from './infraestructura/recepcion.repositorio.pg';
import { ComprasController } from './presentacion/compras.controller';
import { ProveedoresController } from './presentacion/proveedores.controller';

@Module({
  controllers: [ComprasController, ProveedoresController],
  providers: [
    { provide: ORDEN_COMPRA_REPOSITORIO, useClass: OrdenCompraRepositorioPg },
    { provide: PROVEEDOR_REPOSITORIO, useClass: ProveedorRepositorioPg },
    { provide: RECEPCION_REPOSITORIO, useClass: RecepcionRepositorioPg },
    ComprasConsultas, GuardarProveedor, CambiarEstadoProveedor, GuardarBorradorOrdenCompra,
    EnviarAAprobacionOrdenCompra, AprobarOrdenCompra, EnviarOrdenCompra, CerrarOrdenCompra, AnularOrdenCompra,
    RegistrarRecepcion,
  ],
})
export class ComprasModule implements OnModuleInit {
  constructor(
    private readonly sync: RegistroComandosSync,
    private readonly proveedor: GuardarProveedor,
    private readonly borrador: GuardarBorradorOrdenCompra,
    private readonly recepcion: RegistrarRecepcion,
  ) {}

  onModuleInit() {
    // Comandos que el comprador y el bodeguero pueden registrar SIN conexión
    this.sync.registrar('compras.proveedor.guardar', (u, datos) => this.proveedor.ejecutar(u, datos));
    this.sync.registrar('compras.orden.guardar_borrador', (u, datos) => this.borrador.ejecutar(u, datos));
    this.sync.registrar('compras.recepcion.registrar', (u, datos) => this.recepcion.ejecutar(u, datos));
    // Aprobar, cerrar y anular son decisiones del servidor y se hacen en línea (REST).
  }
}
