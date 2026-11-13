// src/features/comun/useEmpresa.ts
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/auth/supabase';
import { api } from '@/offline/api';

/** Devuelve la empresa del usuario (guardada en el dispositivo para trabajar sin conexión). */
export function useEmpresa() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [sinSesion, setSinSesion] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setSinSesion(true); return; }
      let id = localStorage.getItem('empresaId');
      if (!id) {
        try { id = (await api<{ empresaId: string }>('/seguridad/yo')).empresaId; localStorage.setItem('empresaId', id); } catch { /* sin conexión */ }
      }
      setEmpresaId(id);
    })();
  }, []);
  return { empresaId, sinSesion };
}
