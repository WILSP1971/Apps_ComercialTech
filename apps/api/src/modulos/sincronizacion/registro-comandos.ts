// src/modulos/sincronizacion/registro-comandos.ts
import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../infraestructura/auth';

export type ComandoSync = (usuario: UsuarioAutenticado, datos: any, idempotencyKey: string) => Promise<Record<string, unknown>>;

@Injectable()
export class RegistroComandosSync {
  private comandos = new Map<string, ComandoSync>();
  registrar(tipo: string, fn: ComandoSync) { this.comandos.set(tipo, fn); }
  obtener(tipo: string) { return this.comandos.get(tipo); }
}
