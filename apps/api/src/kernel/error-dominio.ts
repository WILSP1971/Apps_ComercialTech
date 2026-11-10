// src/kernel/error-dominio.ts
import { ErrorNegocio } from './errores';
import { Resultado, fallo } from './resultado';

/** Error de regla de negocio con código estable (lo consume la API y la PWA para mostrar mensajes). */
export interface ErrorDominio { codigo: string; mensaje: string }
export type ResultadoD<T> = Resultado<T, ErrorDominio>;

export const falla = (codigo: string, mensaje: string): ResultadoD<never> => fallo({ codigo, mensaje });

/** Convierte un resultado fallido del dominio en un ErrorNegocio (la capa de aplicación lo lanza). */
export function lanzarSiFalla<T>(r: ResultadoD<T>): T {
  if (!r.ok) throw new ErrorNegocio(r.error.codigo, r.error.mensaje);
  return r.valor;
}
