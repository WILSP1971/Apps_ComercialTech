// src/modulos/caja/dominio/referencia-pago.spec.ts   (R10)
import { ReferenciaPago } from './referencia-pago';

describe('ReferenciaPago (R10)', () => {
  it('rechaza un número de tarjeta válido (Luhn), con o sin separadores', () => {
    expect(ReferenciaPago.crear('TARJETA', '4111111111111111').ok).toBe(false);
    expect(ReferenciaPago.crear('TARJETA', '4111 1111 1111 1111').ok).toBe(false);
  });
  it('exige token o autorización en pagos con tarjeta', () => {
    expect(ReferenciaPago.crear('TARJETA', '').ok).toBe(false);
    expect(ReferenciaPago.crear('TARJETA', 'tok_8f3a91c2').ok).toBe(true);
  });
  it('el efectivo no requiere referencia', () => {
    expect(ReferenciaPago.crear('EFECTIVO', undefined).ok).toBe(true);
  });
});
