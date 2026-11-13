import type { Config } from 'tailwindcss';

const c = (v: string) => `rgb(var(--c-${v}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fondo: c('fondo'), panel: c('panel'), panel2: c('panel2'), borde: c('borde'),
        texto: c('texto'), suave: c('suave'),
        azul: c('azul'), verde: c('verde'), ambar: c('ambar'), rojo: c('rojo'), violeta: c('violeta'),
      },
      fontFamily: { sans: ['var(--fuente)', 'system-ui', 'sans-serif'] },
      borderRadius: { tarjeta: '14px' },
      keyframes: {
        entrar: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        aviso: { from: { opacity: '0', transform: 'translateX(12px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: { entrar: 'entrar .22s ease-out both', aviso: 'aviso .2s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
