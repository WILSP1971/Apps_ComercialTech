// src/componentes/Sesion.tsx — sesión, empresa, permisos y estado de conexión/sincronización
'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase } from '@/auth/supabase';
import { api } from '@/offline/api';
import { db } from '@/offline/db';
import { solicitarSync } from '@/offline/motor-sync';

export interface Perfil { id: string; empresaId: string; roles: string[]; permisos: string[] }
interface Valor {
  estado: 'cargando' | 'sinSesion' | 'listo';
  empresaId: string | null;
  email: string;
  perfil: Perfil | null;
  online: boolean;
  porSincronizar: number;
  rechazadas: number;
  puede: (permiso: string) => boolean;
  sincronizar: () => void;
  cerrarSesion: () => Promise<void>;
}
const Ctx = createContext<Valor | null>(null);

const leerPerfil = (): Perfil | null => { try { return JSON.parse(localStorage.getItem('perfil') ?? 'null'); } catch { return null; } };

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Valor['estado']>('cargando');
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const sube = () => setOnline(true), baja = () => setOnline(false);
    window.addEventListener('online', sube); window.addEventListener('offline', baja);
    return () => { window.removeEventListener('online', sube); window.removeEventListener('offline', baja); };
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      if (!data.session) { setEstado('sinSesion'); return; }
      setEmail(data.session.user.email ?? '');

      // Primero lo guardado en el dispositivo (sirve sin conexión); luego se refresca desde el servidor.
      let p = leerPerfil();
      let id = localStorage.getItem('empresaId');
      if (p) setPerfil(p);
      try {
        const yo = await api<Perfil>('/seguridad/yo');
        p = yo; id = yo.empresaId;
        localStorage.setItem('empresaId', id); localStorage.setItem('perfil', JSON.stringify(yo));
      } catch { /* sin conexión: se usa lo guardado */ }
      if (!vivo) return;
      setPerfil(p); setEmpresaId(id);
      setEstado(id ? 'listo' : 'sinSesion');
    })();
    return () => { vivo = false; };
  }, []);

  const porSincronizar = useLiveQuery(() => db.outbox.where('estado').equals('pendiente').count(), [], 0);
  const rechazadas = useLiveQuery(() => db.outbox.where('estado').equals('rechazada').count(), [], 0);

  const puede = useCallback((permiso: string) => {
    if (!perfil) return false;
    return perfil.roles.includes('administrador') || perfil.permisos.includes(permiso);
  }, [perfil]);

  const cerrarSesion = useCallback(async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('empresaId'); localStorage.removeItem('perfil');
    window.location.replace('/login');
  }, []);

  const valor = useMemo<Valor>(() => ({
    estado, empresaId, email, perfil, online, porSincronizar, rechazadas, puede,
    sincronizar: () => { void solicitarSync(); }, cerrarSesion,
  }), [estado, empresaId, email, perfil, online, porSincronizar, rechazadas, puede, cerrarSesion]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion requiere ProveedorSesion');
  return c;
}
