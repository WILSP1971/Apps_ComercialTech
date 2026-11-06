'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/auth/supabase';
import { api } from '@/offline/api';
import { AutoSync } from '@/offline/AutoSync';
import { ListaPedidos } from '@/features/pedidos/ListaPedidos';

export default function Inicio() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [sinSesion, setSinSesion] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { setSinSesion(true); return; }
      let id = localStorage.getItem('empresaId');
      if (!id) {                                   // primera vez: pedir los datos del usuario al servidor
        try {
          const yo = await api<{ empresaId: string }>('/seguridad/yo');
          id = yo.empresaId; localStorage.setItem('empresaId', id);
        } catch { /* sin conexión y sin empresa guardada */ }
      }
      setEmpresaId(id);
    })();
  }, []);

  if (sinSesion) return <main className="p-6"><a className="underline" href="/login">Iniciar sesión</a></main>;
  if (!empresaId) return <main className="p-6">Cargando…</main>;
  return (
    <main>
      <AutoSync empresaId={empresaId} />
      <ListaPedidos />
    </main>
  );
}
