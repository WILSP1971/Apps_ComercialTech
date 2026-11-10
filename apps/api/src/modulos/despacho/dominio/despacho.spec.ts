// src/modulos/despacho/dominio/despacho.spec.ts
import { Despacho } from './despacho';

const id = () => crypto.randomUUID();
const linea = (cantidad = 3) => ({ id: id(), pedidoLineaId: id(), articuloId: id(), cantidad, reservaId: id() });
const base = (lineas = [linea()]) => ({
  id: id(), empresaId: id(), pedidoId: id(), clienteId: id(), bodegaId: id(), direccionEntrega: 'Calle 10 # 5-20, Bogotá', lineas,
});
function programado(lineas?: ReturnType<typeof linea>[]) {
  const r = Despacho.programar(base(lineas));
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.valor;
}

describe('Despacho', () => {
  it('R12: no se programa un despacho sin reservas activas', () => {
    const r = Despacho.programar(base([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('R12_SIN_RESERVA_ACTIVA');
  });

  it('valida dirección, cantidades y reservas repetidas', () => {
    expect(Despacho.programar({ ...base(), direccionEntrega: 'x' }).ok).toBe(false);
    expect(Despacho.programar(base([linea(0)])).ok).toBe(false);
    const l = linea();
    expect(Despacho.programar(base([l, { ...l, id: id() }])).ok).toBe(false);          // misma reserva dos veces
  });

  it('flujo feliz: PROGRAMADO -> DESPACHADO -> ENTREGADO con sus eventos', () => {
    const d = programado();
    expect(d.estado).toBe('PROGRAMADO');
    expect(d.despachar(id(), true).ok).toBe(true);
    expect(d.estado).toBe('DESPACHADO');
    expect(d.registrarEntrega({ receptor: 'María Pérez', evidenciaUrl: 'https://x.co/firma.png' }).ok).toBe(true);
    expect(d.estado).toBe('ENTREGADO');
    const tipos = d.extraerEventos().map(e => e.tipo);
    expect(tipos).toEqual(['despacho.DespachoRealizado', 'despacho.DespachoEntregado']);
  });

  it('el evento DespachoRealizado indica si el pedido quedó completo', () => {
    const d = programado();
    d.despachar(id(), false);
    const ev = d.extraerEventos()[0];
    expect(ev.datos.completo).toBe(false);
    expect((ev.datos.lineas as any[]).length).toBe(1);
  });

  it('no se despacha dos veces ni se entrega sin despachar', () => {
    const d = programado();
    expect(d.registrarEntrega({ receptor: 'Pedro' }).ok).toBe(false);
    d.despachar(id(), true);
    expect(d.despachar(id(), true).ok).toBe(false);
  });

  it('entrega fallida exige motivo; se puede reintentar y luego entregar', () => {
    const d = programado();
    d.despachar(id(), true);
    expect(d.registrarEntregaFallida('no').ok).toBe(false);
    expect(d.registrarEntregaFallida('Cliente ausente').ok).toBe(true);
    expect(d.estado).toBe('FALLIDO');
    expect(d.reintentarEntrega().ok).toBe(true);
    expect(d.snapshot.intentosEntrega).toBe(2);
    expect(d.registrarEntrega({ receptor: 'Portería' }).ok).toBe(true);
  });

  it('solo se cancela un despacho programado, con motivo', () => {
    const a = programado();
    expect(a.cancelar('no').ok).toBe(false);
    expect(a.cancelar('Cambio de dirección').ok).toBe(true);
    expect(a.estado).toBe('CANCELADO');
    const b = programado();
    b.despachar(id(), true);
    expect(b.cancelar('Cambio de dirección').ok).toBe(false);
  });

  it('actualizar logística: la dirección solo antes de despachar', () => {
    const d = programado();
    expect(d.actualizarLogistica({ transportador: 'Servientrega', guia: 'G-1', direccionEntrega: 'Carrera 7 # 80-10' }).ok).toBe(true);
    d.despachar(id(), true);
    expect(d.actualizarLogistica({ guia: 'G-2' }).ok).toBe(true);
    expect(d.actualizarLogistica({ direccionEntrega: 'Otra dirección 123' }).ok).toBe(false);
  });
});
