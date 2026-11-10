// src/modulos/compras/dominio/orden-compra.spec.ts
import { OrdenCompra } from './orden-compra';

const id = () => crypto.randomUUID();
const POLITICA = { umbralSegregacion: 5_000_000 };

function nueva(lineas = [{ cant: 10, costo: 1000 }, { cant: 4, costo: 2500 }], creador = id()) {
  const r = OrdenCompra.crearBorrador({
    id: id(), empresaId: id(), proveedorId: id(), bodegaId: id(), creadoPor: creador,
    lineas: lineas.map(l => ({ id: id(), articuloId: id(), cantidad: l.cant, costoUnitario: l.costo })),
  });
  if (!r.ok) throw new Error(r.error.mensaje);
  return r.valor;
}
const aprobada = () => { const o = nueva(); o.aprobar(id(), 'OC-1', POLITICA); o.extraerEventos(); return o; };
const recibir = (o: OrdenCompra, cantidades: number[]) =>
  o.registrarRecepcion(id(), o.lineas.map((l, i) => ({ recepcionLineaId: id(), ordenLineaId: l.id, cantidad: cantidades[i] })).filter(x => x.cantidad > 0));

describe('OrdenCompra', () => {
  it('calcula el total y valida las líneas', () => {
    expect(nueva().total()).toBe(20000);                                     // 10x1000 + 4x2500
    const sinLineas = OrdenCompra.crearBorrador({ id: id(), empresaId: id(), proveedorId: id(), bodegaId: id(), creadoPor: id(), lineas: [] });
    expect(sinLineas.ok).toBe(false);
    const a = id();
    const repetido = OrdenCompra.crearBorrador({ id: id(), empresaId: id(), proveedorId: id(), bodegaId: id(), creadoPor: id(),
      lineas: [{ id: id(), articuloId: a, cantidad: 1, costoUnitario: 1 }, { id: id(), articuloId: a, cantidad: 1, costoUnitario: 1 }] });
    expect(repetido.ok).toBe(false);
  });

  it('solo se edita en borrador', () => {
    const o = aprobada();
    const r = o.actualizar({ proveedorId: id(), bodegaId: id(), lineas: [{ id: id(), articuloId: id(), cantidad: 1, costoUnitario: 1 }] });
    expect(r.ok).toBe(false);
  });

  it('aprobar asigna número y emite el evento', () => {
    const o = nueva();
    expect(o.aprobar(id(), 'OC-7', POLITICA).ok).toBe(true);
    expect(o.estado).toBe('APROBADA');
    expect(o.numero).toBe('OC-7');
    expect(o.extraerEventos().map(e => e.tipo)).toEqual(['compras.OrdenCompraAprobada']);
  });

  it('segregación de funciones: sobre el umbral no aprueba quien la creó', () => {
    const creador = id();
    const grande = nueva([{ cant: 100, costo: 100000 }], creador);          // 10.000.000
    const r = grande.aprobar(creador, 'OC-1', POLITICA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('SEGREGACION_FUNCIONES');
    expect(grande.aprobar(id(), 'OC-1', POLITICA).ok).toBe(true);
    // bajo el umbral, quien la creó sí puede aprobarla
    const c2 = id();
    expect(nueva(undefined, c2).aprobar(c2, 'OC-2', POLITICA).ok).toBe(true);
  });

  it('no se recibe una orden en borrador', () => {
    const r = recibir(nueva(), [1, 1]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('OC_NO_RECIBIBLE');
  });

  it('recepción parcial -> RECIBIDA_PARCIAL y emite el detalle para Inventarios', () => {
    const o = aprobada();
    const r = recibir(o, [6, 0]);
    expect(r.ok).toBe(true);
    expect(o.estado).toBe('RECIBIDA_PARCIAL');
    expect(o.pendientePorRecibir()).toBe(8);                                 // faltan 4 + 4
    const ev = o.extraerEventos().find(e => e.tipo === 'compras.RecepcionRegistrada')!;
    expect((ev.datos.lineas as any[]).length).toBe(1);
    expect((ev.datos.lineas as any[])[0].cantidad).toBe(6);
  });

  it('no permite recibir más de lo pedido y es atómica (si una línea falla, ninguna se aplica)', () => {
    const o = aprobada();
    const r = recibir(o, [5, 99]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('RECEPCION_EXCEDE_ORDEN');
    expect(o.pendientePorRecibir()).toBe(14);                                // nada cambió
    expect(o.estado).toBe('APROBADA');
  });

  it('R11: no se cierra hasta recibir toda la mercadería', () => {
    const o = aprobada();
    recibir(o, [10, 0]);
    const r = o.cerrar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('R11_OC_SIN_RECIBIR');
    recibir(o, [0, 4]);
    expect(o.estado).toBe('RECIBIDA');
    expect(o.cerrar().ok).toBe(true);
    expect(o.estado).toBe('CERRADA');
  });

  it('anular: exige motivo y solo si no hay mercadería recibida', () => {
    const o = aprobada();
    expect(o.anular('x').ok).toBe(false);
    const parcial = aprobada();
    recibir(parcial, [1, 0]);
    expect(parcial.anular('Proveedor no cumplió').ok).toBe(false);
    expect(o.anular('Proveedor no cumplió').ok).toBe(true);
    expect(o.estado).toBe('ANULADA');
  });
});
