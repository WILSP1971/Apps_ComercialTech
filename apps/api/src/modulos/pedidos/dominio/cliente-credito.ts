// src/modulos/pedidos/dominio/cliente-credito.ts
import { Resultado, ok, fallo } from '../../../kernel/resultado';

/** Modelo de cliente del contexto Pedidos: solo lo necesario para decidir el crédito (R13). */
export class ClienteCredito {
  constructor(
    readonly id: string, readonly empresaId: string,
    readonly limiteCredito: number, private _creditoUsado: number, readonly bloqueado: boolean,
  ) {}
  get creditoUsado() { return this._creditoUsado; }
  get disponible() { return this.limiteCredito - this._creditoUsado; }

  /** R13: ¿el valor supera el crédito disponible? */
  excedeLimite(valor: number): boolean { return valor > this.disponible; }

  consumir(valor: number): Resultado<void> {
    if (this.bloqueado) return fallo('El cliente está bloqueado para crédito');
    this._creditoUsado += valor;
    return ok(undefined);
  }
  liberar(valor: number): void { this._creditoUsado = Math.max(0, this._creditoUsado - valor); }
}
