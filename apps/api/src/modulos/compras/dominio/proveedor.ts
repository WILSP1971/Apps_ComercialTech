// src/modulos/compras/dominio/proveedor.ts
import { ResultadoD, falla } from '../../../kernel/error-dominio';
import { ok } from '../../../kernel/resultado';

export interface PropsProveedor {
  id: string; empresaId: string; nit: string; razonSocial: string;
  correo: string | null; telefono: string | null; plazoDias: number; activo: boolean;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Proveedor {
  private constructor(private props: PropsProveedor) {}

  static crear(p: Omit<PropsProveedor, 'activo'>): ResultadoD<Proveedor> {
    const nit = p.nit.trim();
    if (nit.length < 5) return falla('NIT_INVALIDO', 'El NIT del proveedor es obligatorio');
    if (p.razonSocial.trim().length < 2) return falla('RAZON_SOCIAL_REQUERIDA', 'La razón social es obligatoria');
    if (p.correo && !CORREO.test(p.correo)) return falla('CORREO_INVALIDO', 'El correo no es válido');
    if (!Number.isInteger(p.plazoDias) || p.plazoDias < 0 || p.plazoDias > 365)
      return falla('PLAZO_INVALIDO', 'El plazo de pago debe estar entre 0 y 365 días');
    return ok(new Proveedor({ ...p, nit, razonSocial: p.razonSocial.trim(), activo: true }));
  }
  static reconstituir(props: PropsProveedor): Proveedor { return new Proveedor(props); }

  get id() { return this.props.id; }
  get activo() { return this.props.activo; }
  get snapshot(): Readonly<PropsProveedor> { return this.props; }

  /** Actualiza los datos conservando el estado activo/inactivo actual. */
  actualizar(p: Omit<PropsProveedor, 'activo' | 'id' | 'empresaId'>): ResultadoD<void> {
    const r = Proveedor.crear({ id: this.props.id, empresaId: this.props.empresaId, ...p });
    if (!r.ok) return r;
    this.props = { ...r.valor.props, activo: this.props.activo };
    return ok(undefined);
  }
  desactivar(): void { this.props.activo = false; }
  activar(): void { this.props.activo = true; }
}
