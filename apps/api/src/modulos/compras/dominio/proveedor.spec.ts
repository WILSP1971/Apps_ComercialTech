// src/modulos/compras/dominio/proveedor.spec.ts
import { Proveedor } from './proveedor';

const base = { id: 'p1', empresaId: 'e1', nit: '900123456-1', razonSocial: 'Maderas SAS', correo: 'a@b.co', telefono: null, plazoDias: 30 };

describe('Proveedor', () => {
  it('se crea activo con datos válidos', () => {
    const r = Proveedor.crear(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.activo).toBe(true);
  });
  it('valida NIT, correo y plazo', () => {
    expect(Proveedor.crear({ ...base, nit: '12' }).ok).toBe(false);
    expect(Proveedor.crear({ ...base, correo: 'no-es-correo' }).ok).toBe(false);
    expect(Proveedor.crear({ ...base, plazoDias: 400 }).ok).toBe(false);
  });
  it('actualizar conserva el estado', () => {
    const r = Proveedor.crear(base);
    if (!r.ok) throw new Error('x');
    r.valor.desactivar();
    r.valor.actualizar({ nit: '900123456-1', razonSocial: 'Nuevo nombre', correo: null, telefono: null, plazoDias: 15 });
    expect(r.valor.activo).toBe(false);
    expect(r.valor.snapshot.razonSocial).toBe('Nuevo nombre');
  });
});
