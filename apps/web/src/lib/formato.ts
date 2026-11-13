// src/lib/formato.ts
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

export const dinero = (v: unknown) => cop.format(Number(v) || 0);
export const cantidad = (v: unknown) => num.format(Number(v) || 0);

export function fecha(v: unknown, conHora = false): string {
  if (!v) return '—';
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CO', conHora
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Número de factura con prefijo y relleno: F-00124 */
export const numeroFactura = (f: { prefijo?: string; numero?: number | string }) =>
  f.numero == null ? 'Sin número' : `${f.prefijo ?? 'F'}-${String(f.numero).padStart(5, '0')}`;

export const iniciales = (texto: string) =>
  texto.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';

/** Mismo criterio que R10 en el servidor: algo que parece un número de tarjeta (13–19 dígitos, Luhn válido). */
export function parecePan(texto: string): boolean {
  const d = texto.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let suma = 0, doble = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (doble) { n *= 2; if (n > 9) n -= 9; }
    suma += n; doble = !doble;
  }
  return suma % 10 === 0;
}

export const hoyISO = () => new Date().toISOString().slice(0, 10);

/** Totales de un pedido a partir de sus líneas (igual criterio que el dominio: descuento sobre el bruto, IVA sobre el neto). */
export function totalesLineas(ls: { cantidad: number; precioUnitario: number; descuentoPct?: number; ivaPct?: number }[]) {
  let subtotal = 0, impuestos = 0;
  for (const l of ls) {
    const neto = l.cantidad * l.precioUnitario * (1 - (l.descuentoPct ?? 0) / 100);
    subtotal += neto; impuestos += neto * ((l.ivaPct ?? 0) / 100);
  }
  return { subtotal, impuestos, total: subtotal + impuestos };
}

/** 1 despacho / 2 despachos */
export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
