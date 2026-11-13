// src/lib/series.ts — agrupa valores por día para las miniaturas de tendencia
export function serieDias<T>(items: T[], fecha: (x: T) => unknown, valor: (x: T) => number, dias = 7): number[] {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const salida = new Array(dias).fill(0);
  for (const it of items) {
    const f = new Date(fecha(it) as string);
    if (Number.isNaN(f.getTime())) continue;
    f.setHours(0, 0, 0, 0);
    const d = Math.round((hoy.getTime() - f.getTime()) / 86_400_000);
    if (d >= 0 && d < dias) salida[dias - 1 - d] += valor(it);
  }
  return salida;
}
