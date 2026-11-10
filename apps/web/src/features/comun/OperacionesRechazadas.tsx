// src/features/comun/OperacionesRechazadas.tsx
'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';

/** Muestra las operaciones del módulo que el servidor rechazó (ej. R11, R12), para corregirlas. */
export function OperacionesRechazadas({ prefijo }: { prefijo: string }) {
  const todas = useLiveQuery(() => db.outbox.where('estado').equals('rechazada').toArray(), [], []);
  const lista = todas.filter(o => o.tipo.startsWith(prefijo));
  return <>{lista.map(o => (
    <p key={o.idempotencyKey} className="rounded bg-red-50 p-2 text-sm text-red-700">Operación rechazada ({o.tipo}): {o.error}</p>
  ))}</>;
}
