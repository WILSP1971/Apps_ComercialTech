import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sierra Innova · ERP integrado',
  description: 'Pedidos, facturación, caja, inventarios, fabricación y despacho. Funciona sin conexión.',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#0D1117', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-fondo text-texto antialiased">{children}</body>
    </html>
  );
}
