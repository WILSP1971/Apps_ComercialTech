// src/infraestructura/filtro-errores.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ErrorNegocio } from '../kernel/errores';

/** Errores de negocio -> 422 con código legible (R11, R12...); validaciones Zod -> 400; el resto sigue el flujo normal de Nest. */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) return res.status(e.getStatus()).json(e.getResponse());
    if (e instanceof ErrorNegocio) return res.status(422).json({ codigo: e.codigo, mensaje: e.message });
    if ((e as any)?.name === 'ZodError') return res.status(400).json({ codigo: 'VALIDACION', mensaje: 'Datos inválidos', detalle: (e as any).issues });
    console.error(e);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno' });
  }
}
