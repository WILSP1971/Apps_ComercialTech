import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRM Inteligente',
  description: 'Pedidos, inventarios, fabricación, caja y facturación - Offline-First',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#0f172a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
