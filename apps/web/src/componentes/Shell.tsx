// src/componentes/Shell.tsx — barra lateral, cabecera y marco de las pantallas
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { iniciales } from '@/lib/formato';
import { useSesion } from './Sesion';
import {
  IcCampana, IcCaja, IcCamion, IcCompras, IcDatos, IcFactura, IcInicio, IcInventario, IcMenu, IcNube,
  IcPedidos, IcSalir, IcSinRed, IcSync,
} from './iconos';

const MENU = [
  { grupo: 'Operación', items: [
    { href: '/', texto: 'Menú principal', Ic: IcInicio },
    { href: '/pedidos', texto: 'Pedidos', Ic: IcPedidos },
    { href: '/facturacion', texto: 'Facturación', Ic: IcFactura },
    { href: '/caja', texto: 'Caja', Ic: IcCaja },
  ] },
  { grupo: 'Logística', items: [
    { href: '/inventarios', texto: 'Inventarios y fabricación', Ic: IcInventario },
    { href: '/despacho', texto: 'Despacho de mercancía', Ic: IcCamion },
    { href: '/compras', texto: 'Compras', Ic: IcCompras },
  ] },
  { grupo: 'Configuración', items: [
    { href: '/datos', texto: 'Datos maestros', Ic: IcDatos },
  ] },
];

const TITULOS: Record<string, string> = Object.fromEntries(MENU.flatMap(g => g.items.map(i => [i.href, i.texto])));

export function Shell({ children }: { children: ReactNode }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [campana, setCampana] = useState(false);
  const s = useSesion();
  useEffect(() => { setAbierto(false); setCampana(false); }, [ruta]);

  const rechazadas = useLiveQuery(() => db.outbox.where('estado').equals('rechazada').toArray(), [], []);
  const rol = s.perfil?.roles[0]?.replace(/_/g, ' ') ?? 'sin rol';

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Barra lateral */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-borde bg-panel transition-transform duration-200 lg:static lg:w-auto lg:translate-x-0 ${abierto ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-azul text-sm font-bold text-white">SI</div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Sierra Innova</p>
            <p className="text-xs text-suave">ERP integrado</p>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Principal">
          {MENU.map(g => (
            <div key={g.grupo}>
              <p className="px-2 pb-1.5 text-xs font-medium text-suave/80">{g.grupo}</p>
              <ul className="space-y-0.5">
                {g.items.map(({ href, texto, Ic }) => {
                  const activo = href === '/' ? ruta === '/' : ruta.startsWith(href);
                  return (
                    <li key={href}>
                      <Link href={href} aria-current={activo ? 'page' : undefined}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${activo ? 'bg-azul/15 text-texto' : 'text-suave hover:bg-panel2 hover:text-texto'}`}>
                        <Ic className={activo ? 'text-azul' : 'text-suave group-hover:text-texto'} />
                        <span className="truncate">{texto}</span>
                        {activo && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-azul" aria-hidden />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-borde p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violeta/20 text-xs font-semibold text-violeta">{iniciales(s.email)}</div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{s.email || 'Usuario'}</p>
              <p className="truncate text-xs capitalize text-suave">{rol}</p>
            </div>
            <button className="btn btn-sm !border-transparent !bg-transparent" onClick={s.cerrarSesion} aria-label="Cerrar sesión" title="Cerrar sesión"><IcSalir width={16} height={16} /></button>
          </div>
        </div>
      </aside>
      {abierto && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />}

      {/* Contenido */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-borde bg-fondo/85 px-4 py-3 backdrop-blur lg:px-8">
          <button className="btn btn-sm lg:hidden" onClick={() => setAbierto(true)} aria-label="Abrir menú"><IcMenu width={16} height={16} /></button>
          <p className="truncate text-sm font-medium text-suave">{TITULOS[ruta] ?? TITULOS['/' + ruta.split('/')[1]] ?? ''}</p>

          <div className="ml-auto flex items-center gap-2">
            <EstadoRed />
            <div className="relative">
              <button className="btn btn-sm relative" onClick={() => setCampana(v => !v)} aria-label={`Avisos: ${rechazadas.length}`} aria-expanded={campana}>
                <IcCampana width={16} height={16} />
                {rechazadas.length > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rojo px-1 text-[10px] font-semibold text-white">{rechazadas.length}</span>}
              </button>
              {campana && (
                <div className="tarjeta absolute right-0 mt-2 w-80 max-w-[88vw] animate-entrar shadow-2xl shadow-black/50">
                  <div className="tarjeta-cabecera"><h2 className="titulo-seccion">Operaciones rechazadas</h2></div>
                  <ul className="max-h-72 divide-y divide-borde overflow-y-auto">
                    {rechazadas.length === 0 && <li className="px-4 py-6 text-center text-sm text-suave">Todo lo que envió fue aceptado.</li>}
                    {rechazadas.map(o => (
                      <li key={o.idempotencyKey} className="px-4 py-3 text-sm">
                        <p className="font-medium">{o.tipo}</p>
                        <p className="mt-0.5 text-rojo">{o.error}</p>
                        <button className="btn btn-sm mt-2" onClick={() => db.outbox.delete(o.idempotencyKey)}>Descartar</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8" id="contenido">
          <div className="mx-auto w-full max-w-[88rem] animate-entrar">{children}</div>
        </main>
      </div>
    </div>
  );
}

function EstadoRed() {
  const { online, porSincronizar, sincronizar } = useSesion();
  if (!online) return <span className="insignia i-ambar"><IcSinRed width={14} height={14} />Sin conexión{porSincronizar ? ` · ${porSincronizar} en cola` : ''}</span>;
  if (porSincronizar > 0) return <button className="insignia i-azul" onClick={sincronizar}><IcSync width={14} height={14} />{porSincronizar} por sincronizar</button>;
  return <span className="insignia i-verde"><IcNube width={14} height={14} />Sincronizado</span>;
}
