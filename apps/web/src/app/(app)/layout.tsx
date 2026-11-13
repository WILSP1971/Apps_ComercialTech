'use client';
import { ReactNode, useEffect } from 'react';
import { AutoSync } from '@/offline/AutoSync';
import { ProveedorSesion, useSesion } from '@/componentes/Sesion';
import { ProveedorDialogos } from '@/componentes/ui';
import { Shell } from '@/componentes/Shell';

function Guardia({ children }: { children: ReactNode }) {
  const { estado, empresaId } = useSesion();
  useEffect(() => { if (estado === 'sinSesion') window.location.replace('/login'); }, [estado]);
  if (estado !== 'listo' || !empresaId) {
    return <div className="grid min-h-screen place-items-center text-sm text-suave" role="status">Cargando su espacio de trabajo…</div>;
  }
  return (
    <>
      <AutoSync empresaId={empresaId} />
      <Shell>{children}</Shell>
    </>
  );
}

export default function LayoutApp({ children }: { children: ReactNode }) {
  return (
    <ProveedorSesion>
      <ProveedorDialogos>
        <Guardia>{children}</Guardia>
      </ProveedorDialogos>
    </ProveedorSesion>
  );
}
