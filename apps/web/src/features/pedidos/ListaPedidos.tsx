// src/features/pedidos/ListaPedidos.tsx
'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { confirmarPedido } from '@/offline/repos/pedidos';

const ETIQUETA: Record<string, string> = {
  BORRADOR: 'Borrador', PENDIENTE_APROBACION: 'Pendiente de aprobación del supervisor',
  CONFIRMADO: 'Confirmado', DESPACHADO: 'Despachado', CANCELADO: 'Cancelado', RECHAZADO: 'Rechazado',
};

export function ListaPedidos() {
  const pedidos = useLiveQuery(() => db.pedidos.orderBy('creado_en').reverse().limit(100).toArray(), []);
  const lineas = useLiveQuery(() => db.pedido_lineas.toArray(), [], []);
  const pendientes = useLiveQuery(() => db.outbox.where('estado').equals('pendiente').count(), [], 0);
  const rechazadas = useLiveQuery(() => db.outbox.where('estado').equals('rechazada').toArray(), [], []);

  // R2: resumen por pedido de lo reservado y lo que va a fabricación
  const resumen = (id: string) => {
    const ls = lineas.filter(l => l.pedido_id === id && !l.eliminado_en);
    return { reservado: ls.reduce((s, l) => s + Number(l.cantidad_reservada), 0),
             fabricar: ls.reduce((s, l) => s + Number(l.cantidad_a_fabricar), 0) };
  };

  return (
    <section className="space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <span className="text-sm text-slate-500">{pendientes ? `${pendientes} por sincronizar` : 'Todo sincronizado'}</span>
      </header>

      {rechazadas.map(o => (
        <p key={o.idempotencyKey} className="rounded bg-red-50 p-2 text-sm text-red-700">Operación rechazada: {o.error}</p>
      ))}

      {pedidos?.map(p => {
        const r = resumen(p.id);
        return (
          <article key={p.id} className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="font-medium">{p.numero ?? 'Borrador'}</p>
              <p className="text-sm text-slate-500">
                {ETIQUETA[p.estado] ?? p.estado}{p._confirmando ? ' · confirmando…' : ''}
                {p.estado === 'CONFIRMADO' && ` · ${r.reservado} reservado${r.fabricar ? ` · ${r.fabricar} en fabricación` : ''}`}
                {p.motivo_rechazo ? ` · ${p.motivo_rechazo}` : ''}
              </p>
            </div>
            {p.estado === 'BORRADOR' && !p._confirmando && (
              <button className="rounded-lg bg-emerald-600 px-3 py-1 text-white" onClick={() => confirmarPedido(p.id)}>
                Confirmar
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
