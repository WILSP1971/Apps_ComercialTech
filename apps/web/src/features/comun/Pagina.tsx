// src/features/comun/Pagina.tsx
'use client';
import { ReactNode } from 'react';
import { AutoSync } from '@/offline/AutoSync';
import { useEmpresa } from './useEmpresa';

export function Pagina({ children }: { children: ReactNode }) {
  const { empresaId, sinSesion } = useEmpresa();
  if (sinSesion) return <main className="p-6"><a className="underline" href="/login">Iniciar sesión</a></main>;
  if (!empresaId) return <main className="p-6">Cargando…</main>;
  return (
    <main>
      <AutoSync empresaId={empresaId} />
      <nav className="flex gap-4 border-b p-3 text-sm">
        <a href="/">Pedidos</a><a href="/compras">Compras</a><a href="/despacho">Despacho</a>
      </nav>
      {children}
    </main>
  );
}
