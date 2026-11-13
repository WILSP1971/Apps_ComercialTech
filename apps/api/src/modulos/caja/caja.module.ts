import { Module, OnModuleInit } from '@nestjs/common';
import { RegistroComandosSync } from '../sincronizacion';
import { CajaCasosUso } from './aplicacion/caja.casos-uso';
import { CerrarSesionCaja } from './aplicacion/cerrar-sesion';
import { CajaController } from './presentacion/caja.controller';

@Module({ controllers: [CajaController], providers: [CajaCasosUso, CerrarSesionCaja] })
export class CajaModule implements OnModuleInit {
  constructor(private readonly sync: RegistroComandosSync, private readonly caja: CajaCasosUso) {}

  onModuleInit() {
    // Cobro en efectivo/transferencia registrado sin conexión dentro de una sesión ya abierta
    this.sync.registrar('caja.cobro.registrar', (u, datos, clave) => this.caja.registrarCobro(u, datos, clave));
  }
}
