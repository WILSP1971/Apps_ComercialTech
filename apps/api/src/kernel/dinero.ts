// src/kernel/dinero.ts   (Value Object)
export class Dinero {
  private constructor(private readonly centavos: number, readonly moneda: string) {}
  static de(valor: number, moneda = 'COP'): Dinero { return new Dinero(Math.round(valor * 100), moneda); }
  static cero(moneda = 'COP'): Dinero { return new Dinero(0, moneda); }
  sumar(o: Dinero): Dinero { this.mismaMoneda(o); return new Dinero(this.centavos + o.centavos, this.moneda); }
  multiplicar(factor: number): Dinero { return new Dinero(Math.round(this.centavos * factor), this.moneda); }
  get valor(): number { return this.centavos / 100; }
  private mismaMoneda(o: Dinero) { if (o.moneda !== this.moneda) throw new Error('Monedas distintas'); }
}
