import { Controller, Get } from '@nestjs/common';
import { BaseDatos } from './base-datos';

@Controller('salud')
export class SaludController {
  constructor(private readonly bd: BaseDatos) {}

  @Get()
  async salud() {
    await this.bd.consultar('SELECT 1');
    return { estado: 'ok' };
  }
}
