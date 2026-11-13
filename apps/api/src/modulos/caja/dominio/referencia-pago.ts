// src/modulos/caja/dominio/referencia-pago.ts   (Value Object - R10)
import { Resultado, ok, fallo } from '../../../kernel/resultado';

export type MedioPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CHEQUE';

function luhn(digitos: string): boolean {
  let suma = 0, doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i]);
    if (doble) { n *= 2; if (n > 9) n -= 9; }
    suma += n; doble = !doble;
  }
  return suma % 10 === 0;
}

export class ReferenciaPago {
  private constructor(readonly valor: string | null) {}

  /** R10: solo se acepta token o código de autorización; jamás un número de tarjeta. */
  static crear(medio: MedioPago, texto?: string | null): Resultado<ReferenciaPago> {
    const t = (texto ?? '').trim();
    if (medio === 'TARJETA' && t.length < 6) return fallo('Un pago con tarjeta exige token o código de autorización');
    const soloDigitos = t.replace(/[ -]/g, '');
    if (/^\d{13,19}$/.test(soloDigitos) && luhn(soloDigitos))
      return fallo('La referencia parece un número de tarjeta. No se almacenan datos de tarjeta (use el token de la pasarela)');
    return ok(new ReferenciaPago(t || null));
  }
}
