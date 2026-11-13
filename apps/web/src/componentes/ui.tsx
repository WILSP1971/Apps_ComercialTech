// src/componentes/ui.tsx — piezas de interfaz compartidas por todas las pantallas
'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IcAlerta, IcCerrar, IcCheck } from './iconos';

/* ---------- Insignias ---------- */
export type Tono = 'verde' | 'ambar' | 'rojo' | 'azul' | 'violeta' | 'gris';
const CLASE_TONO: Record<Tono, string> = {
  verde: 'i-verde', ambar: 'i-ambar', rojo: 'i-rojo', azul: 'i-azul', violeta: 'i-violeta', gris: 'i-gris',
};
export function Insignia({ tono = 'gris', punto, children }: { tono?: Tono; punto?: boolean; children: ReactNode }) {
  return (
    <span className={`insignia ${CLASE_TONO[tono]}`}>
      {punto && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** Chip de regla de negocio (R1–R14): le dice a la persona qué regla protege la acción. */
export function ChipRegla({ r, children }: { r: string; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-azul/30 bg-azul/10 px-2 py-0.5 text-xs text-azul">
      <b className="font-semibold">{r}</b>{children && <span className="text-azul/80">{children}</span>}
    </span>
  );
}

/* ---------- Encabezado de página ---------- */
export function Encabezado({ titulo, detalle, acciones, reglas }: { titulo: string; detalle?: string; acciones?: ReactNode; reglas?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{titulo}</h1>
        {detalle && <p className="mt-0.5 max-w-prose text-sm text-suave">{detalle}</p>}
        {reglas && <div className="mt-2 flex flex-wrap gap-1.5">{reglas}</div>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}

/* ---------- Tarjeta con título ---------- */
export function Panel({ titulo, detalle, acciones, children, className = '', cuerpo = true }:
  { titulo?: ReactNode; detalle?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string; cuerpo?: boolean }) {
  return (
    <section className={`tarjeta ${className}`}>
      {(titulo || acciones) && (
        <div className="tarjeta-cabecera">
          <div className="min-w-0">
            <h2 className="titulo-seccion">{titulo}</h2>
            {detalle && <p className="subtitulo mt-0.5">{detalle}</p>}
          </div>
          {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
        </div>
      )}
      {cuerpo ? <div className="tarjeta-cuerpo">{children}</div> : children}
    </section>
  );
}

/* ---------- Sparkline (SVG puro) ---------- */
export function Sparkline({ valores, tono = 'azul', alto = 36 }: { valores: number[]; tono?: 'azul' | 'verde' | 'ambar' | 'rojo' | 'violeta'; alto?: number }) {
  const id = useId();
  const w = 120;
  const datos = valores.length > 1 ? valores : [0, ...valores, ...valores];
  const max = Math.max(...datos), min = Math.min(...datos);
  const rango = max - min || 1;
  const pts = datos.map((v, i) => [(i / (datos.length - 1)) * w, alto - 3 - ((v - min) / rango) * (alto - 8)] as const);
  const linea = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${linea} L${w} ${alto} L0 ${alto} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${alto}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`rgb(var(--c-${tono}))`} stopOpacity=".28" />
          <stop offset="1" stopColor={`rgb(var(--c-${tono}))`} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={linea} fill="none" stroke={`rgb(var(--c-${tono}))`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------- Tarjeta de indicador ---------- */
export function Indicador({ titulo, valor, nota, tono = 'azul', serie, icono }:
  { titulo: string; valor: ReactNode; nota?: ReactNode; tono?: 'azul' | 'verde' | 'ambar' | 'rojo' | 'violeta'; serie?: number[]; icono?: ReactNode }) {
  const color = { azul: 'text-azul', verde: 'text-verde', ambar: 'text-ambar', rojo: 'text-rojo', violeta: 'text-violeta' }[tono];
  return (
    <div className="tarjeta flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-suave">{titulo}</span>
        {icono && <span className={`grid h-7 w-7 place-items-center rounded-lg bg-panel2 ${color}`}>{icono}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{valor}</div>
      {serie ? <Sparkline valores={serie} tono={tono} /> : null}
      {nota && <div className="text-xs text-suave">{nota}</div>}
    </div>
  );
}

/* ---------- Estado vacío ---------- */
export function Vacio({ icono, titulo, detalle, accion }: { icono?: ReactNode; titulo: string; detalle?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icono && <div className="mb-1 grid h-11 w-11 place-items-center rounded-xl bg-panel2 text-suave">{icono}</div>}
      <p className="font-medium">{titulo}</p>
      {detalle && <p className="max-w-sm text-sm text-suave">{detalle}</p>}
      {accion}
    </div>
  );
}

/* ---------- Aviso en línea ---------- */
export function Aviso({ tono = 'azul', children }: { tono?: 'verde' | 'ambar' | 'rojo' | 'azul'; children: ReactNode }) {
  return (
    <div role={tono === 'rojo' ? 'alert' : 'status'} className={`aviso-caja a-${tono}`}>
      <span className="mt-0.5 shrink-0">{tono === 'verde' ? <IcCheck width={16} height={16} /> : <IcAlerta width={16} height={16} />}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ---------- Pestañas ---------- */
export function Pestanas<T extends string>({ valor, onCambio, opciones }: { valor: T; onCambio: (v: T) => void; opciones: { id: T; texto: string; cuenta?: number }[] }) {
  return (
    <div role="tablist" className="inline-flex flex-wrap gap-1 rounded-xl border border-borde bg-panel p-1">
      {opciones.map(o => (
        <button key={o.id} role="tab" aria-selected={valor === o.id} onClick={() => onCambio(o.id)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${valor === o.id ? 'bg-panel2 text-texto shadow-sm' : 'text-suave hover:text-texto'}`}>
          {o.texto}{o.cuenta != null && <span className="ml-1.5 rounded bg-borde/70 px-1.5 text-xs tabular-nums">{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal accesible (Esc cierra, foco atrapado de forma simple) ---------- */
export function Modal({ abierto, onCerrar, titulo, children, pie, ancho = 'max-w-md' }:
  { abierto: boolean; onCerrar: () => void; titulo: string; children: ReactNode; pie?: ReactNode; ancho?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', alTeclear);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => { document.removeEventListener('keydown', alTeclear); previo?.focus?.(); };
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCerrar} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo} className={`tarjeta relative w-full ${ancho} animate-entrar shadow-2xl shadow-black/50`}>
        <div className="tarjeta-cabecera">
          <h2 className="titulo-seccion">{titulo}</h2>
          <button className="btn btn-sm !border-transparent !bg-transparent" onClick={onCerrar} aria-label="Cerrar"><IcCerrar width={16} height={16} /></button>
        </div>
        <div className="tarjeta-cuerpo space-y-3">{children}</div>
        {pie && <div className="flex justify-end gap-2 border-t border-borde px-4 py-3">{pie}</div>}
      </div>
    </div>
  );
}

/* ---------- Diálogos reutilizables: pedir un motivo / confirmar ---------- */
interface PeticionMotivo { titulo: string; detalle?: string; confirmar: string; peligro?: boolean; minimo?: number; etiqueta?: string; sinTexto?: boolean; resolver: (m: string | null) => void }
const DialogosCtx = createContext<{ pedirMotivo: (p: Omit<PeticionMotivo, 'resolver' | 'sinTexto'>) => Promise<string | null>; confirmar: (p: { titulo: string; detalle?: string; confirmar: string; peligro?: boolean }) => Promise<boolean>; avisar: (t: string, tono?: 'ok' | 'error' | 'info') => void } | null>(null);

interface AvisoFlotante { id: number; texto: string; tono: 'ok' | 'error' | 'info' }

export function ProveedorDialogos({ children }: { children: ReactNode }) {
  const [peticion, setPeticion] = useState<PeticionMotivo | null>(null);
  const [texto, setTexto] = useState('');
  const [avisos, setAvisos] = useState<AvisoFlotante[]>([]);
  const n = useRef(0);

  const pedirMotivo = useCallback((p: Omit<PeticionMotivo, 'resolver' | 'sinTexto'>) => new Promise<string | null>(resolver => { setTexto(''); setPeticion({ ...p, resolver }); }), []);
  const avisar = useCallback((t: string, tono: 'ok' | 'error' | 'info' = 'info') => {
    const id = ++n.current;
    setAvisos(a => [...a.slice(-3), { id, texto: t, tono }]);
    setTimeout(() => setAvisos(a => a.filter(x => x.id !== id)), tono === 'error' ? 7000 : 3800);
  }, []);
  const confirmar = useCallback(async (p: { titulo: string; detalle?: string; confirmar: string; peligro?: boolean }) =>
    (await new Promise<string | null>(resolver => { setTexto(''); setPeticion({ ...p, sinTexto: true, resolver }); })) !== null, []);
  const ctx = useMemo(() => ({ pedirMotivo, confirmar, avisar }), [pedirMotivo, confirmar, avisar]);

  const cerrar = (valor: string | null) => { peticion?.resolver(valor); setPeticion(null); };
  const minimo = peticion?.minimo ?? 5;
  const invalido = !peticion?.sinTexto && texto.trim().length < minimo;

  return (
    <DialogosCtx.Provider value={ctx}>
      {children}
      <Modal abierto={!!peticion} onCerrar={() => cerrar(null)} titulo={peticion?.titulo ?? ''}
        pie={<>
          <button className="btn" onClick={() => cerrar(null)}>Cancelar</button>
          <button className={`btn ${peticion?.peligro ? 'btn-peligro-solido' : 'btn-primario'}`} disabled={invalido} onClick={() => cerrar(texto.trim() || 'ok')}>
            {peticion?.confirmar}
          </button>
        </>}>
        {peticion?.detalle && <p className="text-sm text-suave">{peticion.detalle}</p>}
        {!peticion?.sinTexto && <>
          <label className="etiqueta" htmlFor="motivo">{peticion?.etiqueta ?? 'Motivo'} (mínimo {minimo} caracteres)</label>
          <textarea id="motivo" className="campo min-h-[84px]" value={texto} onChange={e => setTexto(e.target.value)} />
        </>}
      </Modal>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {avisos.map(a => (
          <div key={a.id} className={`pointer-events-auto animate-aviso rounded-lg border px-3.5 py-2.5 text-sm shadow-lg shadow-black/40 backdrop-blur ${
            a.tono === 'ok' ? 'border-verde/40 bg-panel text-verde' : a.tono === 'error' ? 'border-rojo/40 bg-panel text-rojo' : 'border-borde bg-panel text-texto'}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </DialogosCtx.Provider>
  );
}

export function useDialogos() {
  const c = useContext(DialogosCtx);
  if (!c) throw new Error('useDialogos requiere ProveedorDialogos');
  return c;
}

/* ---------- Pastilla de progreso (barra fina) ---------- */
export function Barra({ valor, max, tono = 'azul' }: { valor: number; max: number; tono?: 'azul' | 'verde' | 'ambar' | 'rojo' | 'violeta' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (valor / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: `rgb(var(--c-${tono}))` }} />
    </div>
  );
}

/* ---------- Campo con etiqueta ---------- */
export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-suave">{ayuda}</span>}
    </label>
  );
}
