// src/offline/motor-sync.ts
import { supabase } from '@/auth/supabase';
import { api, ErrorHttp } from './api';
import { db, TABLAS_LOCALES } from './db';
import { v4 as uuid } from 'uuid';

let enCurso = false;
let pendiente = false;

function dispositivoId(): string {
  let id = localStorage.getItem('dispositivoId');
  if (!id) { id = uuid(); localStorage.setItem('dispositivoId', id); }
  return id;
}

/** Punto de entrada único: se puede llamar muchas veces, se agrupan. */
export async function solicitarSync(): Promise<void> {
  if (!navigator.onLine) return;
  if (enCurso) { pendiente = true; return; }
  enCurso = true;
  try {
    do {
      pendiente = false;
      await push();
      await pull();
    } while (pendiente);
  } catch (e) {
    if (!(e instanceof ErrorHttp) || e.estado >= 500) console.warn('Sync pospuesta', e);
  } finally {
    enCurso = false;
  }
}

async function push() {
  for (;;) {
    const lote = (await db.outbox.where('estado').equals('pendiente').sortBy('creadoEn')).slice(0, 50);
    if (lote.length === 0) return;

    const { resultados } = await api<{ resultados: any[] }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        dispositivoId: dispositivoId(),
        operaciones: lote.map(o => ({ idempotencyKey: o.idempotencyKey, tipo: o.tipo, datos: o.datos, creadoEn: o.creadoEn })),
      }),
    });

    for (const r of resultados) {
      if (r.estado === 'OK') await db.outbox.delete(r.idempotencyKey);
      else await db.outbox.update(r.idempotencyKey, { estado: 'rechazada', error: r.mensaje });
    }
  }
}

async function pull() {
  let desde = Number((await db.meta.get('ultima_secuencia'))?.valor ?? 0);
  for (;;) {
    const r = await api<{ cambios: any[]; hasta: number; hayMas: boolean }>(`/sync/pull?desde=${desde}&limite=500`);
    await aplicarCambios(r.cambios, r.hasta);
    desde = r.hasta;
    if (!r.hayMas) return;
  }
}

async function aplicarCambios(cambios: any[], hasta: number) {
  // No pisar registros que tienen operaciones locales pendientes
  const pendientes = new Set((await db.outbox.where('estado').equals('pendiente').toArray()).map(o => o.registroId));

  await db.transaction('rw', [...db.tables], async () => {
    for (const c of cambios) {
      const nombre = TABLAS_LOCALES[c.tabla];
      if (!nombre || pendientes.has(c.registroId)) continue;
      const tabla = (db as any)[nombre];
      if (c.operacion === 'D') await tabla.delete(c.registroId);
      else await tabla.put(c.payload);             // el servidor es la fuente de verdad
    }
    await db.meta.put({ clave: 'ultima_secuencia', valor: hasta });
  });
}

/** Arranca disparadores: red, foco, temporizador, Realtime y Background Sync. */
export function iniciarMotor(empresaId: string): () => void {
  const lanzar = () => void solicitarSync();
  window.addEventListener('online', lanzar);
  const onVis = () => document.visibilityState === 'visible' && lanzar();
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(lanzar, 30_000);

  // Supabase Realtime: la tabla "sync.senal" avisa que hay cambios nuevos
  const canal = supabase
    .channel(`sync-${empresaId}`)
    .on('postgres_changes', { event: '*', schema: 'sync', table: 'senal', filter: `empresa_id=eq.${empresaId}` }, lanzar)
    .subscribe();

  // El Service Worker avisa cuando el navegador recupera conectividad (Background Sync)
  const onMsg = (e: MessageEvent) => e.data?.tipo === 'SYNC' && lanzar();
  navigator.serviceWorker?.addEventListener('message', onMsg);

  navigator.storage?.persist?.();      // pide que el navegador no borre los datos locales
  lanzar();

  return () => {
    window.removeEventListener('online', lanzar);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(timer);
    supabase.removeChannel(canal);
    navigator.serviceWorker?.removeEventListener('message', onMsg);
  };
}
