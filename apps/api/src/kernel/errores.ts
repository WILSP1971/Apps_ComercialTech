// src/kernel/errores.ts
export class ErrorNegocio extends Error {
  constructor(public readonly codigo: string, mensaje: string) { super(mensaje); }
}
