// src/modulos/compras/dominio/orden-compra.ts
import { RaizAgregado } from '../../../kernel/raiz-agregado';
import { ResultadoD, falla } from '../../../kernel/error-dominio';
import { ok } from '../../../kernel/resultado';

export type EstadoOrdenCompra =
  | 'BORRADOR' | 'PENDIENTE_APROBACION' | 'APROBADA' | 'ENVIADA'
  | 'RECIBIDA_PARCIAL' | 'RECIBIDA' | 'CERRADA' | 'ANULADA';

export interface NuevaLineaOC { id: string; articuloId: string; cantidad: number; costoUnitario: number }
export interface LineaOrdenCompra extends NuevaLineaOC { cantidadRecibida: number }

export interface PropsOrdenCompra {
  id: string; empresaId: string; proveedorId: string; bodegaId: string;
  estado: EstadoOrdenCompra; numero: string | null;
  creadoPor: string; aprobadoPor: string | null; aprobadoEn: string | null; enviadaEn: string | null;
  fechaEsperada: string | null; motivoAnulacion: string | null; observaciones: string | null;
  lineas: LineaOrdenCompra[]; version: number;
}

export interface NuevaOrdenCompra {
  id: string; empresaId: string; proveedorId: string; bodegaId: string; creadoPor: string;
  fechaEsperada?: string | null; observaciones?: string | null; lineas: NuevaLineaOC[];
}

export interface LineaRecibida { recepcionLineaId: string; ordenLineaId: string; cantidad: number }
export interface DetalleRecepcion extends LineaRecibida { articuloId: string; costoUnitario: number }

/** Política de aprobación: sobre el umbral, quien crea la orden NO puede aprobarla (segregación de funciones). */
export interface PoliticaAprobacion { umbralSegregacion: number }

const redondear = (n: number, d = 2) => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function validarLineas(lineas: NuevaLineaOC[]): ResultadoD<void> {
  if (lineas.length === 0) return falla('OC_SIN_LINEAS', 'La orden de compra debe tener al menos una línea');
  const articulos = new Set<string>();
  const ids = new Set<string>();
  for (const l of lineas) {
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) return falla('CANTIDAD_INVALIDA', 'Las cantidades deben ser mayores a cero');
    if (!Number.isFinite(l.costoUnitario) || l.costoUnitario < 0) return falla('COSTO_INVALIDO', 'El costo unitario no puede ser negativo');
    if (articulos.has(l.articuloId)) return falla('ARTICULO_DUPLICADO', 'Un artículo no puede repetirse en la misma orden (sume las cantidades)');
    if (ids.has(l.id)) return falla('LINEA_DUPLICADA', 'Identificador de línea repetido');
    articulos.add(l.articuloId); ids.add(l.id);
  }
  return ok(undefined);
}

export class OrdenCompra extends RaizAgregado {
  private constructor(private props: PropsOrdenCompra) { super(); }

  static crearBorrador(p: NuevaOrdenCompra): ResultadoD<OrdenCompra> {
    const v = validarLineas(p.lineas);
    if (!v.ok) return v;
    if (p.fechaEsperada && !FECHA.test(p.fechaEsperada)) return falla('FECHA_INVALIDA', 'La fecha esperada debe tener formato AAAA-MM-DD');
    return ok(new OrdenCompra({
      id: p.id, empresaId: p.empresaId, proveedorId: p.proveedorId, bodegaId: p.bodegaId,
      estado: 'BORRADOR', numero: null, creadoPor: p.creadoPor, aprobadoPor: null, aprobadoEn: null, enviadaEn: null,
      fechaEsperada: p.fechaEsperada ?? null, motivoAnulacion: null, observaciones: p.observaciones ?? null,
      lineas: p.lineas.map(l => ({ ...l, cantidadRecibida: 0 })), version: 0,
    }));
  }
  static reconstituir(props: PropsOrdenCompra): OrdenCompra { return new OrdenCompra(props); }

  get id() { return this.props.id; }
  get empresaId() { return this.props.empresaId; }
  get estado() { return this.props.estado; }
  get numero() { return this.props.numero; }
  get lineas() { return this.props.lineas.map(l => ({ ...l })); }
  get snapshot(): Readonly<PropsOrdenCompra> { return this.props; }

  total(): number { return redondear(this.props.lineas.reduce((s, l) => s + l.cantidad * l.costoUnitario, 0)); }
  pendientePorRecibir(): number { return redondear(this.props.lineas.reduce((s, l) => s + (l.cantidad - l.cantidadRecibida), 0), 3); }

  private evento(tipo: string, datos: Record<string, unknown>, agregadoId: string = this.props.id) {
    this.registrar({ tipo, agregadoId, empresaId: this.props.empresaId, ocurrioEn: new Date(), datos });
  }

  actualizar(p: { proveedorId: string; bodegaId: string; fechaEsperada?: string | null; observaciones?: string | null; lineas: NuevaLineaOC[] }): ResultadoD<void> {
    if (this.props.estado !== 'BORRADOR') return falla('OC_NO_EDITABLE', 'Solo se puede editar una orden en borrador');
    const v = validarLineas(p.lineas);
    if (!v.ok) return v;
    if (p.fechaEsperada && !FECHA.test(p.fechaEsperada)) return falla('FECHA_INVALIDA', 'La fecha esperada debe tener formato AAAA-MM-DD');
    this.props.proveedorId = p.proveedorId;
    this.props.bodegaId = p.bodegaId;
    this.props.fechaEsperada = p.fechaEsperada ?? null;
    this.props.observaciones = p.observaciones ?? null;
    this.props.lineas = p.lineas.map(l => ({ ...l, cantidadRecibida: 0 }));
    return ok(undefined);
  }

  enviarAAprobacion(): ResultadoD<void> {
    if (this.props.estado !== 'BORRADOR') return falla('OC_ESTADO_INVALIDO', `No se puede enviar a aprobación una orden ${this.props.estado}`);
    this.props.estado = 'PENDIENTE_APROBACION';
    return ok(undefined);
  }

  aprobar(usuarioId: string, numero: string, politica: PoliticaAprobacion): ResultadoD<void> {
    if (!['BORRADOR', 'PENDIENTE_APROBACION'].includes(this.props.estado))
      return falla('OC_ESTADO_INVALIDO', `No se puede aprobar una orden ${this.props.estado}`);
    if (this.total() > politica.umbralSegregacion && usuarioId === this.props.creadoPor)
      return falla('SEGREGACION_FUNCIONES', 'Una orden sobre el umbral debe ser aprobada por una persona distinta a quien la creó');
    this.props.estado = 'APROBADA';
    this.props.numero = numero;
    this.props.aprobadoPor = usuarioId;
    this.props.aprobadoEn = new Date().toISOString();
    this.evento('compras.OrdenCompraAprobada', { ordenId: this.props.id, numero, proveedorId: this.props.proveedorId, total: this.total() });
    return ok(undefined);
  }

  marcarEnviada(): ResultadoD<void> {
    if (this.props.estado !== 'APROBADA') return falla('OC_ESTADO_INVALIDO', 'Solo se envía al proveedor una orden aprobada');
    this.props.estado = 'ENVIADA';
    this.props.enviadaEn = new Date().toISOString();
    return ok(undefined);
  }

  /** Recibe mercadería. Valida TODAS las líneas antes de modificar nada (atómico). */
  registrarRecepcion(recepcionId: string, lineas: LineaRecibida[]): ResultadoD<DetalleRecepcion[]> {
    if (!['APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL'].includes(this.props.estado))
      return falla('OC_NO_RECIBIBLE', `No se puede recibir una orden en estado ${this.props.estado}`);
    if (lineas.length === 0) return falla('RECEPCION_VACIA', 'La recepción no tiene líneas');

    const vistas = new Set<string>();
    const detalle: DetalleRecepcion[] = [];
    for (const r of lineas) {
      if (!Number.isFinite(r.cantidad) || r.cantidad <= 0) return falla('CANTIDAD_INVALIDA', 'Las cantidades recibidas deben ser mayores a cero');
      if (vistas.has(r.ordenLineaId)) return falla('LINEA_DUPLICADA', 'Una línea de la orden no puede repetirse en la misma recepción');
      vistas.add(r.ordenLineaId);
      const l = this.props.lineas.find(x => x.id === r.ordenLineaId);
      if (!l) return falla('LINEA_NO_EXISTE', 'La línea no pertenece a la orden de compra');
      if (redondear(l.cantidadRecibida + r.cantidad, 3) > l.cantidad)
        return falla('RECEPCION_EXCEDE_ORDEN', 'La cantidad recibida excede lo pedido en la orden');
      detalle.push({ recepcionLineaId: r.recepcionLineaId, ordenLineaId: l.id, articuloId: l.articuloId, cantidad: r.cantidad, costoUnitario: l.costoUnitario });
    }
    for (const d of detalle) {
      const l = this.props.lineas.find(x => x.id === d.ordenLineaId)!;
      l.cantidadRecibida = redondear(l.cantidadRecibida + d.cantidad, 3);
    }
    this.props.estado = this.props.lineas.every(l => l.cantidadRecibida >= l.cantidad) ? 'RECIBIDA' : 'RECIBIDA_PARCIAL';
    this.evento('compras.RecepcionRegistrada',
      { recepcionId, ordenId: this.props.id, bodegaId: this.props.bodegaId, lineas: detalle }, recepcionId);
    return ok(detalle);
  }

  /** R11: la orden de compra no se cierra hasta recibir toda la mercadería. */
  cerrar(): ResultadoD<void> {
    if (!['RECIBIDA', 'RECIBIDA_PARCIAL'].includes(this.props.estado))
      return falla('OC_NO_CERRABLE', `No se puede cerrar una orden en estado ${this.props.estado}`);
    if (this.props.lineas.some(l => l.cantidadRecibida < l.cantidad))
      return falla('R11_OC_SIN_RECIBIR', 'No se puede cerrar la orden: hay mercadería sin recibir');
    this.props.estado = 'CERRADA';
    this.evento('compras.OrdenCompraCerrada', { ordenId: this.props.id, numero: this.props.numero, total: this.total() });
    return ok(undefined);
  }

  /** Solo se anula una orden sin mercadería recibida (si ya recibió algo, se recibe el resto o se gestiona con el proveedor). */
  anular(motivo: string): ResultadoD<void> {
    if (['RECIBIDA_PARCIAL', 'RECIBIDA', 'CERRADA', 'ANULADA'].includes(this.props.estado))
      return falla('OC_NO_ANULABLE', `No se puede anular una orden en estado ${this.props.estado}`);
    if (this.props.lineas.some(l => l.cantidadRecibida > 0)) return falla('OC_CON_RECEPCIONES', 'La orden ya tiene mercadería recibida');
    if (motivo.trim().length < 5) return falla('MOTIVO_REQUERIDO', 'Indique el motivo de la anulación (mínimo 5 caracteres)');
    this.props.estado = 'ANULADA';
    this.props.motivoAnulacion = motivo.trim();
    this.evento('compras.OrdenCompraAnulada', { ordenId: this.props.id, numero: this.props.numero, motivo: motivo.trim() });
    return ok(undefined);
  }
}
