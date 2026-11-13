// apps/web/e2e/offline.spec.ts
import { test, expect } from '@playwright/test';

test('crea un pedido sin conexión y se sincroniza al reconectar', async ({ page, context }) => {
  await page.goto('/pedidos');
  await context.setOffline(true);

  await page.getByRole('tab', { name: 'Nuevo pedido' }).click();
  // ... diligenciar cliente y líneas ...
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('1 por sincronizar')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Sincronizado')).toBeVisible({ timeout: 15_000 });
});
