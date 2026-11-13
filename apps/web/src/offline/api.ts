// src/offline/api.ts
import { supabase } from '@/auth/supabase';

/** Error HTTP con el cuerpo que devolvió la API (los errores de negocio llegan como 422 {codigo, mensaje}). */
export class ErrorHttp extends Error {
  constructor(public estado: number, public cuerpo?: { codigo?: string; mensaje?: string } | null) {
    super(cuerpo?.mensaje ?? `HTTP ${estado}`);
  }
  get codigo() { return this.cuerpo?.codigo; }
}

export async function api<T = any>(ruta: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const empresaId = localStorage.getItem('empresaId') ?? '';
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1${ruta}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'X-Empresa-Id': empresaId,
      ...init.headers,
    },
  });
  if (!res.ok) {
    let cuerpo: any = null;
    try { cuerpo = await res.json(); } catch { /* sin cuerpo */ }
    throw new ErrorHttp(res.status, cuerpo);
  }
  return res.json();
}

/** Texto para mostrar a la persona: mensaje de negocio si lo hay, o una causa entendible. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorHttp) {
    if (e.cuerpo?.mensaje) return e.cuerpo.mensaje;
    if (e.estado === 401) return 'Su sesión venció. Vuelva a iniciar sesión.';
    if (e.estado === 403) return 'Su rol no tiene permiso para esta acción.';
    if (e.estado >= 500) return 'El servidor no pudo completar la operación. Intente de nuevo en unos segundos.';
    return `No se pudo completar la operación (${e.estado}).`;
  }
  if (e instanceof TypeError) return 'Sin conexión con el servidor. Esta acción requiere internet.';
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
}
