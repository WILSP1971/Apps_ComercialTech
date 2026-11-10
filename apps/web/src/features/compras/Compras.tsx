// src/features/compras/Compras.tsx
'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api } from '@/offline/api';
import { OperacionesRechazadas } from '../comun/OperacionesRechazadas';
import { guardarBorradorOrden, guardarProveedor, nuevoId, registrarRecepcion } from '@/offline/repos/compras';

const ETIQUETA: Record<string, string> = {
  BORRADOR: 'Borrador', PENDIENTE_APROBACION: 'Pendiente de aprobación', APROBADA: 'Aprobada', ENVIADA: 'Enviada al proveedor',
  RECIBIDA_PARCIAL: 'Recibida parcial', RECIBIDA: 'Recibida', CERRADA: 'Cerrada', ANULADA: 'Anulada',
};

/** Acciones que requieren conexión: las valida el servidor (segregación de funciones, R11). */
async function accion(id: string, ruta: string, cuerpo: object = {}) {
  try { await api(`/compras/ordenes/${id}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }); }
  catch (e: any) { alert(e.estado === 422 ? 'El servidor rechazó la operación (revise el estado de la orden y las reglas)' : 'Requiere conexión'); }
}

export function Compras() {
  const proveedores = useLiveQuery(() => db.proveedores.orderBy('razon_social').toArray(), [], []);
  const ordenes = useLiveQuery(() => db.ordenes_compra.orderBy('creado_en').reverse().limit(100).toArray(), [], []);
  const lineas = useLiveQuery(() => db.orden_compra_lineas.toArray(), [], []);
  const articulos = useLiveQuery(() => db.articulos.toArray(), [], []);
  const bodegas = useLiveQuery(() => db.bodegas.toArray(), [], []);
  const [nit, setNit] = useState(''); const [razon, setRazon] = useState('');
  const [provId, setProvId] = useState(''); const [bodegaId, setBodegaId] = useState('');
  const [artId, setArtId] = useState(''); const [cant, setCant] = useState(1); const [costo, setCosto] = useState(0);
  const [recibir, setRecibir] = useState<Record<string, number>>({});

  const nombreProv = (id: string) => proveedores.find(p => p.id === id)?.razon_social ?? '—';
  const nombreArt = (id: string) => articulos.find(a => a.id === id)?.nombre ?? id.slice(0, 8);

  return (
    <section className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Compras</h1>
      <OperacionesRechazadas prefijo="compras." />

      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer font-medium">Proveedores ({proveedores.length})</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="rounded border p-1" placeholder="NIT" value={nit} onChange={e => setNit(e.target.value)} />
          <input className="rounded border p-1" placeholder="Razón social" value={razon} onChange={e => setRazon(e.target.value)} />
          <button className="rounded bg-emerald-600 px-3 py-1 text-white" disabled={nit.length < 5 || razon.length < 2}
            onClick={async () => { await guardarProveedor({ id: nuevoId(), nit, razonSocial: razon, plazoDias: 30 }); setNit(''); setRazon(''); }}>
            Agregar
          </button>
        </div>
        <ul className="mt-2 text-sm">{proveedores.map(p => <li key={p.id}>{p.razon_social} · {p.nit}{p.activo ? '' : ' (inactivo)'}</li>)}</ul>
      </details>

      <details className="rounded-xl border p-3" open>
        <summary className="cursor-pointer font-medium">Nueva orden de compra (una línea)</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="rounded border p-1" value={provId} onChange={e => setProvId(e.target.value)}>
            <option value="">Proveedor…</option>{proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
          <select className="rounded border p-1" value={bodegaId} onChange={e => setBodegaId(e.target.value)}>
            <option value="">Bodega…</option>{bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre ?? b.codigo}</option>)}
          </select>
          <select className="rounded border p-1" value={artId} onChange={e => setArtId(e.target.value)}>
            <option value="">Artículo…</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <input className="w-20 rounded border p-1" type="number" min={1} value={cant} onChange={e => setCant(Number(e.target.value))} />
          <input className="w-28 rounded border p-1" type="number" min={0} value={costo} onChange={e => setCosto(Number(e.target.value))} />
          <button className="rounded bg-emerald-600 px-3 py-1 text-white" disabled={!provId || !bodegaId || !artId || cant <= 0}
            onClick={() => guardarBorradorOrden({ id: nuevoId(), proveedorId: provId, bodegaId, lineas: [{ id: nuevoId(), articuloId: artId, cantidad: cant, costoUnitario: costo }] })}>
            Guardar borrador
          </button>
        </div>
      </details>

      {ordenes.map(o => {
        const ls = lineas.filter(l => l.orden_id === o.id && !l.eliminado_en);
        return (
          <article key={o.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{o.numero ?? 'Borrador'} · {nombreProv(o.proveedor_id)}</p>
                <p className="text-sm text-slate-500">{ETIQUETA[o.estado] ?? o.estado} · Total {Number(o.total).toLocaleString('es-CO')}{o._pendiente ? ' · por sincronizar' : ''}</p>
              </div>
              <div className="flex gap-2 text-sm">
                {o.estado === 'BORRADOR' && <button className="rounded border px-2" onClick={() => accion(o.id, 'enviar-aprobacion')}>Enviar a aprobación</button>}
                {o.estado === 'PENDIENTE_APROBACION' && <button className="rounded border px-2" onClick={() => accion(o.id, 'aprobar')}>Aprobar</button>}
                {o.estado === 'APROBADA' && <button className="rounded border px-2" onClick={() => accion(o.id, 'enviar')}>Marcar enviada</button>}
                {o.estado === 'RECIBIDA' && <button className="rounded border px-2" onClick={() => accion(o.id, 'cerrar')}>Cerrar</button>}
                {['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA'].includes(o.estado) &&
                  <button className="rounded border px-2 text-red-700" onClick={() => { const motivo = prompt('Motivo de anulación'); if (motivo) accion(o.id, 'anular', { motivo }); }}>Anular</button>}
              </div>
            </div>
            <ul className="text-sm">
              {ls.map(l => {
                const pendiente = Number(l.cantidad) - Number(l.cantidad_recibida);
                const puedeRecibir = ['ENVIADA', 'RECIBIDA_PARCIAL'].includes(o.estado) && pendiente > 0;
                return (
                  <li key={l.id} className="flex items-center justify-between py-0.5">
                    <span>{nombreArt(l.articulo_id)} · {l.cantidad_recibida}/{l.cantidad} recibido</span>
                    {puedeRecibir && (
                      <span className="flex gap-1">
                        <input className="w-20 rounded border p-0.5" type="number" min={1} max={pendiente} placeholder={`≤ ${pendiente}`}
                          value={recibir[l.id] ?? ''} onChange={e => setRecibir({ ...recibir, [l.id]: Number(e.target.value) })} />
                        <button className="rounded bg-sky-600 px-2 text-white" disabled={!(recibir[l.id] > 0) || recibir[l.id] > pendiente}
                          onClick={async () => { await registrarRecepcion({ ordenId: o.id, lineas: [{ ordenLineaId: l.id, cantidad: recibir[l.id] }] }); setRecibir({ ...recibir, [l.id]: 0 }); }}>
                          Recibir
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
