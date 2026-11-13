// src/infraestructura/eventos.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from './base-datos';
import { EventoDominio } from '../kernel/raiz-agregado';

export interface EventoOutbox { id: string; empresa_id: string; tipo: string; agregado_id: string; payload: any; }
type Manejador = (e: EventoOutbox) => Promise<void>;

@Injectable()
export class BusEventos {
  private manejadores = new Map<string, Manejador[]>();
  suscribir(tipo: string, m: Manejador) {
    this.manejadores.set(tipo, [...(this.manejadores.get(tipo) ?? []), m]);
  }
  async emitir(e: EventoOutbox) {
    for (const m of this.manejadores.get(e.tipo) ?? []) await m(e);
  }
}

@Injectable()
export class PublicadorEventos {
  constructor(private readonly bd: BaseDatos) {}
  /** Se llama DENTRO de la misma transacción que guarda el agregado. */
  async publicar(eventos: EventoDominio[]): Promise<void> {
    for (const e of eventos) {
      await this.bd.consultar(
        `INSERT INTO nucleo.evento_outbox (empresa_id, tipo, agregado_id, payload) VALUES ($1,$2,$3,$4)`,
        [e.empresaId, e.tipo, e.agregadoId, JSON.stringify(e.datos)],
      );
    }
  }
}

@Injectable()
export class DespachadorOutbox implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ocupado = false;
  constructor(private readonly bd: BaseDatos, private readonly bus: BusEventos) {}

  onModuleInit() { this.timer = setInterval(() => this.ciclo().catch(console.error), 1000); }
  onModuleDestroy() { clearInterval(this.timer); }

  private async ciclo() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      for (;;) {
        // Reclama lote (autocommit). Los manejadores deben ser idempotentes (entrega "al menos una vez").
        const lote = await this.bd.consultar<EventoOutbox>(
          `UPDATE nucleo.evento_outbox SET intentos = intentos + 1
            WHERE id IN (SELECT id FROM nucleo.evento_outbox
                          WHERE procesado_en IS NULL AND intentos < 10
                          ORDER BY creado_en LIMIT 20 FOR UPDATE SKIP LOCKED)
          RETURNING id, empresa_id, tipo, agregado_id, payload`);
        if (lote.length === 0) break;
        for (const e of lote) {
          try {
            await this.bus.emitir(e);
            await this.bd.consultar(`UPDATE nucleo.evento_outbox SET procesado_en = now() WHERE id = $1`, [e.id]);
          } catch (err) {
            console.error(`Evento ${e.tipo} (${e.id}) falló`, err);
          }
        }
      }
    } finally { this.ocupado = false; }
  }
}
