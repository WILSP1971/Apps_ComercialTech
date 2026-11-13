// src/componentes/iconos.tsx — iconos de trazo (24x24), sin dependencias
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});
const I = (d: string | string[]) => (p: P) => (
  <svg {...base(p)}>{(Array.isArray(d) ? d : [d]).map((x, i) => <path key={i} d={x} />)}</svg>
);

export const IcInicio = I(['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6']);
export const IcPedidos = I(['M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z', 'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2', 'M8 12h8M8 16h5']);
export const IcFactura = I(['M6 3h12v18l-3-2-3 2-3-2-3 2V3z', 'M9 8h6M9 12h6']);
export const IcCaja = I(['M3 7h18v12H3z', 'M3 11h18', 'M7 15h3', 'M7 7V5h10v2']);
export const IcInventario = I(['M21 8l-9-5-9 5 9 5 9-5z', 'M3 8v8l9 5 9-5V8', 'M12 13v8']);
export const IcCamion = I(['M2 6h11v10H2z', 'M13 10h4l4 3v3h-8', 'M6.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', 'M17.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z']);
export const IcCompras = I(['M3 4h2l2.4 11h10.2L20 7H6', 'M9 20a1 1 0 100-2 1 1 0 000 2z', 'M17 20a1 1 0 100-2 1 1 0 000 2z']);
export const IcDatos = I(['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6']);
export const IcCampana = I(['M6 9a6 6 0 1112 0c0 6 2 7 2 7H4s2-1 2-7', 'M10 20a2 2 0 004 0']);
export const IcSync = I(['M20 11a8 8 0 00-14-4L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0014 4l2-2', 'M20 20v-5h-5']);
export const IcNube = I(['M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18H7z']);
export const IcSinRed = I(['M3 3l18 18', 'M8.5 8.6A5 5 0 007 10a4 4 0 000 8h10c.6 0 1.2-.1 1.7-.4', 'M10 5.2A5 5 0 0116.6 9 4.5 4.5 0 0121 12.5']);
export const IcEscudo = I(['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z', 'M9 12l2 2 4-4']);
export const IcCandado = I(['M6 11h12v9H6z', 'M8 11V8a4 4 0 018 0v3']);
export const IcMas = I(['M12 5v14M5 12h14']);
export const IcCerrar = I(['M6 6l12 12M18 6L6 18']);
export const IcCheck = I(['M5 12.5l4.5 4.5L19 7.5']);
export const IcAlerta = I(['M12 3l10 18H2L12 3z', 'M12 10v5', 'M12 18.5v.01']);
export const IcBuscar = I(['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3']);
export const IcSalir = I(['M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4', 'M16 8l4 4-4 4', 'M20 12H9']);
export const IcMenu = I(['M4 7h16M4 12h16M4 17h16']);
export const IcReloj = I(['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 7v5l3 2']);
export const IcLlave = I(['M15 8a4 4 0 11-3.9 4.9L4 20v-3h3v-2h2l2.1-2.1A4 4 0 0115 8z']);
export const IcTarjeta = I(['M3 6h18v12H3z', 'M3 10h18', 'M6 15h4']);
export const IcDeshacer = I(['M9 7L4 12l5 5', 'M4 12h10a6 6 0 010 12']);
export const IcFabrica = I(['M3 21V10l6 3V10l6 3V6h6v15H3z', 'M8 17h1M13 17h1M18 17h1']);
export const IcFlecha = I(['M5 12h14', 'M13 6l6 6-6 6']);
