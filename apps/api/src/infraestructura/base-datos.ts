// src/infraestructura/base-datos.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class BaseDatos {
  private readonly als = new AsyncLocalStorage<PoolClient>();
  constructor(private readonly pool: Pool) {}

  async consultar<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const cliente = this.als.getStore();
    const r = cliente ? await cliente.query(sql, params) : await this.pool.query(sql, params);
    return r.rows as T[];
  }

  /** Ejecuta fn dentro de una transacción. Si ya hay una activa, se reutiliza. */
  async transaccion<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await this.als.run(cliente, fn);
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }
  }
}
