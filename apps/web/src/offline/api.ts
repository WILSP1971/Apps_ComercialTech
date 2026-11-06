// src/offline/api.ts
import { supabase } from '@/auth/supabase';

export class ErrorHttp extends Error { constructor(public estado: number) { super(`HTTP ${estado}`); } }

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
  if (!res.ok) throw new ErrorHttp(res.status);
  return res.json();
}
