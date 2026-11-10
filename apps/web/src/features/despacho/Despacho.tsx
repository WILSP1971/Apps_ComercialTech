// src/features/despacho/Despacho.tsx
'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api } from '@/offline/api';
import { OperacionesRechazadas } from '../comun/OperacionesRechazadas';
import { despacharPedido, registrarEntrega, registrarEntregaFallida } from '@/offline/repos/despacho';

const ETIQUETA: Record<string, string> = {
  PROGRAMADO: 'Programado', DESPACHADO: 'En ruta', ENTREGADO: 'Entregado', FALLIDO: 'Entrega fallida', CANCELADO: 'Cancelado',
};

export function Despacho() {
  const pedidos = useLiveQuery(() => db.pedidos.where('estado').equals('CONFIRMADO').toArray(), [], []);
  const despachos = useLiveQuery(() => db.despachos.orderBy('creado_en').reverse().limit(100).toArray(), [], []);
  const [guia, setGuia] = useState(''); const [transp, setTransp] = useState('');
  const [receptor, setReceptor] = useState<Record<string, string>>({});

  // Un pedido confirmado sigue pendiente mientras no tenga un despacho vigente que lo cubra por completo
  const conDespacho = new Set(despachos.filter(d => d.estado !== 'CANCELADO').map(d => d.pedido_id));
  const pendientes = pedidos.filter(p => !conDespacho.has(p.id));

  return (
    <section className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Despacho</h1>
      <OperacionesRechazadas prefijo="despacho." />

      <div className="rounded-xl border p-3">
        <h2 className="font-medium">Pedidos listos para despachar ({pendientes.length})</h2>
        <div className="my-2 flex gap-2 text-sm">
          <input className="rounded border p-1" placeholder="Transportador" value={transp} onChange={e => setTransp(e.target.value)} />
          <input className="rounded border p-1" placeholder="Guía" value={guia} onChange={e => setGuia(e.target.value)} />
        </div>
        {pendientes.map(p => (
          <div key={p.id} className="flex items-center justify-between py-1 text-sm">
            <span>{p.numero ?? p.id.slice(0, 8)} · {Number(p.total).toLocaleString('es-CO')}</span>
            <button className="rounded bg-emerald-600 px-3 py-1 text-white"
              onClick={() => despacharPedido({ pedidoId: p.id, transportador: transp || undefined, guia: guia || undefined })}>
              Despachar
            </button>
          </div>
        ))}
        <p className="mt-1 text-xs text-slate-500">R12: solo se despacha mercadería con reserva de stock activa; el servidor lo confirma al sincronizar.</p>
      </div>

      {despachos.map(d => (
        <article key={d.id} className="rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{d.numero ?? 'Despacho'} · pedido {String(d.pedido_id).slice(0, 8)}</p>
              <p className="text-sm text-slate-500">
                {ETIQUETA[d.estado] ?? d.estado}{d.guia ? ` · guía ${d.guia}` : ''}{d.receptor ? ` · recibió ${d.receptor}` : ''}
                {d.motivo_fallo ? ` · ${d.motivo_fallo}` : ''}{d._pendiente ? ' · por sincronizar' : ''}
              </p>
            </div>
            {d.estado === 'DESPACHADO' && (
              <div className="flex gap-1 text-sm">
                <input className="rounded border p-1" placeholder="Quién recibe" value={receptor[d.id] ?? ''} onChange={e => setReceptor({ ...receptor, [d.id]: e.target.value })} />
                <button className="rounded bg-sky-600 px-2 text-white" disabled={(receptor[d.id] ?? '').trim().length < 3}
                  onClick={() => registrarEntrega({ despachoId: d.id, receptor: receptor[d.id] })}>Entregado</button>
                <button className="rounded border px-2 text-red-700"
                  onClick={() => { const motivo = prompt('Motivo de la entrega fallida'); if (motivo && motivo.trim().length >= 5) registrarEntregaFallida({ despachoId: d.id, motivo }); }}>Falló</button>
              </div>
            )}
            {d.estado === 'FALLIDO' && (
              <button className="rounded border px-2 text-sm" onClick={() => api(`/despachos/${d.id}/reintentar`, { method: 'POST' }).catch(() => alert('Requiere conexión'))}>Reintentar</button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
