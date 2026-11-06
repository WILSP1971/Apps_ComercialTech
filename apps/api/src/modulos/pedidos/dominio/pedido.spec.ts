// src/modulos/pedidos/dominio/pedido.spec.ts
import { Dinero } from '../../../kernel/dinero';
import { ClienteCredito } from './cliente-credito';
import { Pedido } from './pedido';

const id = () => crypto.randomUUID();
const linea = (cantidad: number) => ({
  id: id(), articuloId: id(), descripcion: 'Mesa de roble', cantidad,
  precioUnitario: Dinero.de(10000), descuentoPct: 10, ivaPct: 19,
});
const nuevo = (cond: 'CONTADO' | 'CREDITO', lineas = [linea(2)]) => {
  const r = Pedido.crearBorrador({ id: id(), empresaId: id(), clienteId: id(), vendedorId: id(), bodegaId: id(),
                                   canal: 'MOSTRADOR', condicionPago: cond, lineas });
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};
const cliente = (limite: number, usado = 0, bloqueado = false) => new ClienteCredito(id(), id(), limite, usado, bloqueado);

describe('Pedido', () => {
  it('calcula subtotal, IVA y total', () => {
    const p = nuevo('CONTADO');
    expect(p.subtotal().valor).toBe(18000);   // 2 x 10000 - 10%
    expect(p.total().valor).toBe(21420);      // + 19%
  });

  it('R1/R2: mezcla de líneas - reserva lo disponible y manda el faltante a fabricar', () => {
    const p = nuevo('CONTADO', [linea(10), linea(5)]);
    const [a, b] = p.lineas;
    expect(p.confirmar('PED-1', [{ lineaId: a.id, reservada: 10 }, { lineaId: b.id, reservada: 2 }]).ok).toBe(true);
    const [la, lb] = p.lineas;
    expect([la.cantidadReservada, la.cantidadAFabricar]).toEqual([10, 0]);   // todo con stock
    expect([lb.cantidadReservada, lb.cantidadAFabricar]).toEqual([2, 3]);    // 3 a fabricar
    const evento = p.extraerEventos().find(e => e.tipo === 'pedidos.PedidoConfirmado')!;
    expect((evento.datos.lineas as any[]).filter(l => l.aFabricar > 0)).toHaveLength(1);
  });

  it('R1: sin nada de stock, toda la línea va a fabricación', () => {
    const p = nuevo('CONTADO', [linea(4)]);
    p.confirmar('PED-1', []);
    expect(p.lineas[0].cantidadAFabricar).toBe(4);
  });

  it('R13: pedido a crédito que excede el límite requiere aprobación', () => {
    const p = nuevo('CREDITO');                                    // total 21 420
    expect(p.evaluarCredito(cliente(20000))).toBe('REQUIERE_APROBACION');
    expect(p.evaluarCredito(cliente(30000, 10000))).toBe('REQUIERE_APROBACION');   // disponible 20 000
    expect(p.evaluarCredito(cliente(30000))).toBe('OK');
  });

  it('R13: cliente bloqueado no puede comprar a crédito; contado no se evalúa', () => {
    expect(nuevo('CREDITO').evaluarCredito(cliente(1_000_000, 0, true))).toBe('BLOQUEADO');
    expect(nuevo('CONTADO').evaluarCredito(cliente(0))).toBe('OK');
  });

  it('un pedido pendiente de aprobación se puede confirmar luego (aprobación)', () => {
    const p = nuevo('CREDITO');
    expect(p.enviarAAprobacion(1420).ok).toBe(true);
    expect(p.estado).toBe('PENDIENTE_APROBACION');
    expect(p.confirmar('PED-9', []).ok).toBe(true);
  });

  it('no permite confirmar dos veces ni un pedido sin líneas', () => {
    const p = nuevo('CONTADO');
    p.confirmar('PED-1', []);
    expect(p.confirmar('PED-2', []).ok).toBe(false);
    const r = Pedido.crearBorrador({ id: id(), empresaId: id(), clienteId: id(), vendedorId: id(), bodegaId: id(),
                                     canal: 'MOSTRADOR', condicionPago: 'CONTADO', lineas: [] });
    if (r.ok) expect(r.valor.confirmar('PED-3', []).ok).toBe(false);
  });
});
