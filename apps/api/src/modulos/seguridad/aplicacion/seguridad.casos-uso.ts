import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ErrorNegocio } from '../../../kernel/errores';

const UsuarioSchema = z.object({
  id: z.string().uuid(),                       // = auth.users.id de Supabase Auth
  nombre: z.string().min(2),
  correo: z.string().email(),
  roles: z.array(z.string()).min(1),
  clienteId: z.string().uuid().optional(),     // solo para el rol cliente_web
});

@Injectable()
export class SeguridadCasosUso {
  constructor(private readonly bd: BaseDatos) {}

  /** Administrador: crea/actualiza un usuario y le asigna uno o varios roles en la empresa. */
  async guardarUsuario(empresaId: string, entrada: unknown) {
    const d = UsuarioSchema.parse(entrada);
    if (d.roles.includes('cliente_web') && !d.clienteId)
      throw new ErrorNegocio('CLIENTE_REQUERIDO', 'El rol cliente_web exige clienteId');
    return this.bd.transaccion(async () => {
      await this.bd.consultar(
        `INSERT INTO seguridad.usuario (id, nombre, correo) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET nombre=$2, correo=$3`, [d.id, d.nombre, d.correo]);
      await this.bd.consultar(
        `UPDATE seguridad.usuario_empresa SET activo=false WHERE usuario_id=$1 AND empresa_id=$2`, [d.id, empresaId]);
      for (const codigo of d.roles) {
        const [rol] = await this.bd.consultar(`SELECT id FROM seguridad.rol WHERE codigo=$1`, [codigo]);
        if (!rol) throw new ErrorNegocio('ROL_NO_EXISTE', `El rol ${codigo} no existe`);
        await this.bd.consultar(
          `INSERT INTO seguridad.usuario_empresa (usuario_id, empresa_id, rol_id, cliente_id, activo)
           VALUES ($1,$2,$3,$4,true)
           ON CONFLICT (usuario_id, empresa_id, rol_id) DO UPDATE SET activo=true, cliente_id=$4`,
          [d.id, empresaId, rol.id, d.clienteId ?? null]);
      }
      return {};
    });
  }

  listarUsuarios(empresaId: string) {
    return this.bd.consultar(
      `SELECT u.id, u.nombre, u.correo, array_agg(r.codigo) AS roles
         FROM seguridad.usuario u
         JOIN seguridad.usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = $1 AND ue.activo
         JOIN seguridad.rol r ON r.id = ue.rol_id
        GROUP BY u.id ORDER BY u.nombre`, [empresaId]);
  }
}
