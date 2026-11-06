// src/modulos/pedidos/dominio/pedido.ts
import { RaizAgregado } from '../../../kernel/raiz-agregado';
import { Dinero } from '../../../kernel/dinero';
import { Resultado, ok, fallo } from '../../../kernel/resultado';
import { ClienteCredito } from './cliente-credito';

export type EstadoPedido = 'BORRADOR' | 'PENDIENTE_APROBACION' | 'CONFIRMADO' | 'DESPACHADO' | 'CANCELADO' | 'RECHAZADO';
export type CondicionPago = 'CONTADO' | 'CREDITO';
export type Canal = 'MOSTRADOR' | 'WEB' | 'TELEFONO';
export type VeredictoCredito = 'OK' | 'REQUIERE_APROBACION' | 'BLOQUEADO';

export interface LineaPedido {
  id: string; articuloId: string; descripcion: string; cantidad: number;
  precioUnitario: Dinero; descuentoPct: number; ivaPct: number;
  cantidadReservada: number;      // R2: parte cubierta con stock
  cantidadAFabricar: number;      // R2: parte que genera Orden de Fabricación
}
export interface ReservaLinea { lineaId: string; reservada: number }

export interface PropsPedido {
  id: string; empresaId: string; clienteId: string; vendedorId: string; bodegaId: string;
  canal: Canal; condicionPago: CondicionPago; estado: EstadoPedido;
  numero: string | null; motivoRechazo: string | null; lineas: LineaPedido[]; version: number;
}
export type NuevoPedido = Omit<PropsPedido, 'estado' | 'numero' | 'motivoRechazo' | 'version' | 'lineas'> & {
  lineas: Omit<LineaPedido, 'cantidadReservada' | 'cantidadAFabricar'>[];
};

export class Pedido extends RaizAgregado {
  private constructor(private props: PropsPedido) { super(); }

  static crearBorrador(p: NuevoPedido): Resultado<Pedido> {
    if (p.lineas.some(l => l.cantidad <= 0)) return fallo('Las cantidades deben ser mayores a cero');
    const lineas = p.lineas.map(l => ({ ...l, cantidadReservada: 0, cantidadAFabricar: 0 }));
    return ok(new Pedido({ ...p, lineas, estado: 'BORRADOR', numero: null, motivoRechazo: null, version: 0 }));
  }
  static reconstituir(props: PropsPedido): Pedido { return new Pedido(props); }

  get id() { return this.props.id; }
  get empresaId() { return this.props.empresaId; }
  get estado() { return this.props.estado; }
  get numero() { return this.props.numero; }
  get lineas() { return [...this.props.lineas]; }
  get snapshot(): Readonly<PropsPedido> { return this.props; }

  subtotal(): Dinero {
    return this.props.lineas.reduce(
      (a, l) => a.sumar(l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100))), Dinero.cero());
  }
  impuestos(): Dinero {
    return this.props.lineas.reduce(
      (a, l) => a.sumar(l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100) * (l.ivaPct / 100))), Dinero.cero());
  }
  total(): Dinero { return this.subtotal().sumar(this.impuestos()); }

  reemplazarLineas(lineas: NuevoPedido['lineas']): Resultado<void> {
    if (this.props.estado !== 'BORRADOR') return fallo('Solo se puede editar un pedido en borrador');
    this.props.lineas = lineas.map(l => ({ ...l, cantidadReservada: 0, cantidadAFabricar: 0 }));
    return ok(undefined);
  }

  /** R13: decide si el pedido a crédito puede confirmarse, requiere al supervisor o está bloqueado. */
  evaluarCredito(cliente: ClienteCredito): VeredictoCredito {
    if (this.props.condicionPago !== 'CREDITO') return 'OK';
    if (cliente.bloqueado) return 'BLOQUEADO';
    return cliente.excedeLimite(this.total().valor) ? 'REQUIERE_APROBACION' : 'OK';
  }

  enviarAAprobacion(valorExcedido: number): Resultado<void> {
    if (this.props.estado !== 'BORRADOR') return fallo(`No se puede enviar a aprobación un pedido ${this.props.estado}`);
    this.props.estado = 'PENDIENTE_APROBACION';
    this.registrar({
      tipo: 'pedidos.PedidoRequiereAprobacion', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: { pedidoId: this.id, clienteId: this.props.clienteId, total: this.total().valor, valorExcedido },
    });
    return ok(undefined);
  }

  /**
   * R1 y R2: recibe lo que Inventarios pudo reservar por línea. Lo reservado queda en cantidadReservada
   * y el faltante en cantidadAFabricar. El evento lleva solo las líneas con faltante hacia Fabricación.
   */
  confirmar(numero: string, reservas: ReservaLinea[]): Resultado<void> {
    if (!['BORRADOR', 'PENDIENTE_APROBACION'].includes(this.props.estado))
      return fallo(`No se puede confirmar un pedido en estado ${this.props.estado}`);
    if (this.props.lineas.length === 0) return fallo('El pedido no tiene líneas');

    for (const l of this.props.lineas) {
      const reservada = reservas.find(r => r.lineaId === l.id)?.reservada ?? 0;
      l.cantidadReservada = Math.min(Math.max(reservada, 0), l.cantidad);
      l.cantidadAFabricar = l.cantidad - l.cantidadReservada;
    }
    this.props.estado = 'CONFIRMADO';
    this.props.numero = numero;
    this.registrar({
      tipo: 'pedidos.PedidoConfirmado', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: {
        pedidoId: this.id, numero, clienteId: this.props.clienteId, bodegaId: this.props.bodegaId,
        condicionPago: this.props.condicionPago, total: this.total().valor,
        lineas: this.props.lineas.map(l => ({
          pedidoLineaId: l.id, articuloId: l.articuloId, cantidad: l.cantidad,
          reservada: l.cantidadReservada, aFabricar: l.cantidadAFabricar,
        })),
      },
    });
    return ok(undefined);
  }

  rechazar(motivo: string): Resultado<void> {
    if (this.props.estado !== 'PENDIENTE_APROBACION') return fallo('Solo se rechaza un pedido pendiente de aprobación');
    this.props.estado = 'RECHAZADO';
    this.props.motivoRechazo = motivo;
    return ok(undefined);
  }

  cancelar(): Resultado<void> {
    if (['DESPACHADO', 'CANCELADO'].includes(this.props.estado)) return fallo('El pedido no se puede cancelar');
    this.props.estado = 'CANCELADO';
    this.registrar({
      tipo: 'pedidos.PedidoCancelado', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: { pedidoId: this.id, total: this.total().valor, condicionPago: this.props.condicionPago, clienteId: this.props.clienteId },
    });
    return ok(undefined);
  }
}

// ---- Puertos de repositorio (interfaces) ----
export const PEDIDO_REPOSITORIO = Symbol('PEDIDO_REPOSITORIO');
export interface PedidoRepositorio {
  obtener(id: string, empresaId: string): Promise<Pedido | null>;     // con bloqueo FOR UPDATE
  guardar(pedido: Pedido): Promise<void>;
  siguienteNumero(empresaId: string, serie: string): Promise<string>;
}

export const CLIENTE_CREDITO_REPOSITORIO = Symbol('CLIENTE_CREDITO_REPOSITORIO');
export interface ClienteCreditoRepositorio {
  obtener(id: string, empresaId: string): Promise<ClienteCredito | null>;   // con bloqueo FOR UPDATE
  guardar(c: ClienteCredito): Promise<void>;
}
