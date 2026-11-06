// src/kernel/raiz-agregado.ts
export interface EventoDominio {
  readonly tipo: string;                 // 'pedidos.PedidoConfirmado'
  readonly agregadoId: string;
  readonly empresaId: string;
  readonly datos: Record<string, unknown>;
  readonly ocurrioEn: Date;
}

export abstract class RaizAgregado {
  private eventos: EventoDominio[] = [];
  protected registrar(evento: EventoDominio): void { this.eventos.push(evento); }
  extraerEventos(): EventoDominio[] { const e = this.eventos; this.eventos = []; return e; }
}
