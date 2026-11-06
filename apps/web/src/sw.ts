// src/sw.ts
import { defaultCache } from '@serwist/next/worker';
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,      // cachea el "app shell" (JS, CSS, páginas estáticas)
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Nunca cachear la API ni la autenticación: los datos viven en IndexedDB
    { matcher: ({ url }) => /^(api|auth)\.sierrainnova\.tech$/.test(url.hostname), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: { entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }] },
});
serwist.addEventListeners();

// Background Sync: cuando vuelve la red, avisa a la app para sincronizar
(self as any).addEventListener('sync', (event: any) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil(self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ tipo: 'SYNC' }))));
  }
});
