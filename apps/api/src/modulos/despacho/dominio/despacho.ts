// src/modulos/despacho/dominio/despacho.ts
import { RaizAgregado } from '../../../kernel/raiz-agregado';
import { ResultadoD, falla } from '../../../kernel/error-dominio';
import { ok } from '../../../kernel/resultado';

export type EstadoDespacho = 'PROGRAMADO' | 'DESPACHADO' | 'ENTREGADO' | 'FALLIDO' | 'CANCELADO';

export interface LineaDespacho {
  id: string; pedidoLineaId: string; articuloId: string; cantidad: number;
  reservaId: string;                       // R12: la reserva ACTIVA que respalda la salida
}

export interface PropsDespacho {
  id: string; empresaId: string; pedidoId: string; clienteId: string; bodegaId: string;
  numero: string | null; direccionEntrega: string; estado: EstadoDespacho;
  transportador: string | null; guia: string | null; fechaProgramada: string | null;
  despachadoPor: string | null; despachadoEn: string | null; entregadoEn: string | null;
  receptor: string | null; evidenciaUrl: string | null; motivoFallo: string | null; intentosEntrega: number;
  lineas: LineaDespacho[]; version: number;
}

export interface NuevoDespacho {
  id: string; empresaId: string; pedidoId: string; clienteId: string; bodegaId: string;
  direccionEntrega: string; transportador?: string | null; guia?: string | null; fechaProgramada?: string | null;
  lineas: LineaDespacho[];
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class Despacho extends RaizAgregado {
  private constructor(private props: PropsDespacho) { super(); }

  static programar(p: NuevoDespacho): ResultadoD<Despacho> {
    if (p.direccionEntrega.trim().length < 5) return falla('DIRECCION_REQUERIDA', 'Indique la dirección de entrega');
    if (p.lineas.length === 0) return falla('R12_SIN_RESERVA_ACTIVA', 'No hay mercadería con reserva de stock activa para despachar');
    if (p.fechaProgramada && !FECHA.test(p.fechaProgramada)) return falla('FECHA_INVALIDA', 'La fecha debe tener formato AAAA-MM-DD');
    const reservas = new Set<string>();
    for (const l of p.lineas) {
      if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) return falla('CANTIDAD_INVALIDA', 'Las cantidades deben ser mayores a cero');
      if (reservas.has(l.reservaId)) return falla('RESERVA_DUPLICADA', 'Una reserva no puede repetirse en el despacho');
      reservas.add(l.reservaId);
    }
    return ok(new Despacho({
      id: p.id, empresaId: p.empresaId, pedidoId: p.pedidoId, clienteId: p.clienteId, bodegaId: p.bodegaId,
      numero: null, direccionEntrega: p.direccionEntrega.trim(), estado: 'PROGRAMADO',
      transportador: p.transportador ?? null, guia: p.guia ?? null, fechaProgramada: p.fechaProgramada ?? null,
      despachadoPor: null, despachadoEn: null, entregadoEn: null, receptor: null, evidenciaUrl: null,
      motivoFallo: null, intentosEntrega: 0, lineas: p.lineas.map(l => ({ ...l })), version: 0,
    }));
  }
  static reconstituir(props: PropsDespacho): Despacho { return new Despacho(props); }

  get id() { return this.props.id; }
  get empresaId() { return this.props.empresaId; }
  get estado() { return this.props.estado; }
  get numero() { return this.props.numero; }
  get pedidoId() { return this.props.pedidoId; }
  get bodegaId() { return this.props.bodegaId; }
  get lineas() { return this.props.lineas.map(l => ({ ...l })); }
  get snapshot(): Readonly<PropsDespacho> { return this.props; }

  asignarNumero(numero: string) { if (!this.props.numero) this.props.numero = numero; }

  private evento(tipo: string, datos: Record<string, unknown>) {
    this.registrar({ tipo, agregadoId: this.props.id, empresaId: this.props.empresaId, ocurrioEn: new Date(), datos });
  }

  actualizarLogistica(p: { transportador?: string | null; guia?: string | null; fechaProgramada?: string | null; direccionEntrega?: string }): ResultadoD<void> {
    if (!['PROGRAMADO', 'DESPACHADO'].includes(this.props.estado))
      return falla('DESPACHO_ESTADO_INVALIDO', `No se pueden modificar los datos de un despacho ${this.props.estado}`);
    if (p.fechaProgramada && !FECHA.test(p.fechaProgramada)) return falla('FECHA_INVALIDA', 'La fecha debe tener formato AAAA-MM-DD');
    if (p.transportador !== undefined) this.props.transportador = p.transportador;
    if (p.guia !== undefined) this.props.guia = p.guia;
    if (p.fechaProgramada !== undefined) this.props.fechaProgramada = p.fechaProgramada;
    if (p.direccionEntrega !== undefined) {
      if (this.props.estado !== 'PROGRAMADO') return falla('DESPACHO_ESTADO_INVALIDO', 'La dirección solo se cambia antes del despacho');
      if (p.direccionEntrega.trim().length < 5) return falla('DIRECCION_REQUERIDA', 'Indique la dirección de entrega');
      this.props.direccionEntrega = p.direccionEntrega.trim();
    }
    return ok(undefined);
  }

  /**
   * Saca la mercadería de la bodega. La capa de aplicación consume las reservas en Inventarios ANTES de llamar
   * a este método (R12) y el cambio de estado queda en la misma transacción que los asientos de kardex.
   * `completo` lo calcula la aplicación: indica si, con este despacho, el pedido queda totalmente despachado.
   */
  despachar(usuarioId: string, completo: boolean): ResultadoD<void> {
    if (this.props.estado !== 'PROGRAMADO') return falla('DESPACHO_ESTADO_INVALIDO', `No se puede despachar un despacho ${this.props.estado}`);
    this.props.estado = 'DESPACHADO';
    this.props.despachadoPor = usuarioId;
    this.props.despachadoEn = new Date().toISOString();
    this.props.intentosEntrega = 1;
    this.evento('despacho.DespachoRealizado', {
      despachoId: this.props.id, numero: this.props.numero, pedidoId: this.props.pedidoId, clienteId: this.props.clienteId,
      bodegaId: this.props.bodegaId, completo,
      lineas: this.props.lineas.map(l => ({ pedidoLineaId: l.pedidoLineaId, articuloId: l.articuloId, cantidad: l.cantidad })),
    });
    return ok(undefined);
  }

  registrarEntrega(p: { receptor: string; evidenciaUrl?: string | null }): ResultadoD<void> {
    if (this.props.estado !== 'DESPACHADO') return falla('DESPACHO_ESTADO_INVALIDO', `No se puede registrar la entrega de un despacho ${this.props.estado}`);
    if (p.receptor.trim().length < 3) return falla('RECEPTOR_REQUERIDO', 'Indique quién recibe la mercadería');
    this.props.estado = 'ENTREGADO';
    this.props.entregadoEn = new Date().toISOString();
    this.props.receptor = p.receptor.trim();
    this.props.evidenciaUrl = p.evidenciaUrl ?? null;
    this.props.motivoFallo = null;
    this.evento('despacho.DespachoEntregado', {
      despachoId: this.props.id, pedidoId: this.props.pedidoId, clienteId: this.props.clienteId,
      receptor: this.props.receptor, entregadoEn: this.props.entregadoEn,
    });
    return ok(undefined);
  }

  registrarEntregaFallida(motivo: string): ResultadoD<void> {
    if (this.props.estado !== 'DESPACHADO') return falla('DESPACHO_ESTADO_INVALIDO', `No se puede registrar un fallo en un despacho ${this.props.estado}`);
    if (motivo.trim().length < 5) return falla('MOTIVO_REQUERIDO', 'Indique el motivo (mínimo 5 caracteres)');
    this.props.estado = 'FALLIDO';
    this.props.motivoFallo = motivo.trim();
    this.evento('despacho.EntregaFallida', {
      despachoId: this.props.id, pedidoId: this.props.pedidoId, clienteId: this.props.clienteId,
      motivo: this.props.motivoFallo, intento: this.props.intentosEntrega,
    });
    return ok(undefined);
  }

  /** Nuevo intento de entrega: la mercadería sigue fuera de bodega, así que no toca inventario. */
  reintentarEntrega(): ResultadoD<void> {
    if (this.props.estado !== 'FALLIDO') return falla('DESPACHO_ESTADO_INVALIDO', 'Solo se reintenta la entrega de un despacho fallido');
    this.props.estado = 'DESPACHADO';
    this.props.intentosEntrega += 1;
    this.props.motivoFallo = null;
    return ok(undefined);
  }

  /** Solo se cancela un despacho aún no despachado: libera las reservas para otro despacho. */
  cancelar(motivo: string): ResultadoD<void> {
    if (this.props.estado !== 'PROGRAMADO') return falla('DESPACHO_NO_CANCELABLE', `No se puede cancelar un despacho ${this.props.estado}`);
    if (motivo.trim().length < 5) return falla('MOTIVO_REQUERIDO', 'Indique el motivo (mínimo 5 caracteres)');
    this.props.estado = 'CANCELADO';
    this.props.motivoFallo = motivo.trim();
    return ok(undefined);
  }
}
