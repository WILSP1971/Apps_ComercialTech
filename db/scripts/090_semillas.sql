-- db/scripts/090_semillas.sql
INSERT INTO seguridad.rol (codigo, nombre) VALUES
  ('vendedor','Vendedor (mostrador)'), ('cliente_web','Cliente web'),
  ('supervisor_ventas','Supervisor de ventas'), ('bodeguero','Bodeguero'),
  ('planificador_produccion','Planificador de producción'), ('cajero','Cajero'),
  ('contador','Contador'), ('comprador','Comprador'), ('administrador','Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO seguridad.permiso (codigo) VALUES
  ('pedidos.pedido.crear'), ('pedidos.pedido.confirmar'), ('pedidos.pedido.aprobar'), ('pedidos.pedido.cancelar'),
  ('tienda.catalogo.ver'), ('tienda.checkout.crear'), ('tienda.pedido.seguimiento'),
  ('inventarios.existencia.ver'), ('inventarios.conteo.registrar'), ('inventarios.ajuste.registrar'),
  ('fabricacion.orden.liberar'), ('fabricacion.orden.programar'), ('fabricacion.orden.reportar'),
  ('caja.sesion.abrir'), ('caja.sesion.cerrar'), ('caja.cobro.registrar'),
  ('caja.arqueo.realizar'), ('caja.movimiento.reversar'),
  ('facturacion.factura.emitir'), ('facturacion.factura.anular'),
  ('facturacion.conciliacion.realizar'), ('facturacion.cartera.ver'),
  ('compras.proveedor.gestionar'), ('compras.orden.crear'), ('compras.orden.aprobar'), ('compras.recepcion.registrar'),
  ('despacho.despacho.gestionar'),
  ('catalogo.articulo.gestionar'), ('catalogo.cliente.gestionar'),
  ('seguridad.usuario.gestionar'), ('seguridad.rol.gestionar'),
  ('reportes.ver')
ON CONFLICT DO NOTHING;

INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('vendedor','pedidos.pedido.crear'), ('vendedor','pedidos.pedido.confirmar'),
    ('vendedor','inventarios.existencia.ver'), ('vendedor','caja.cobro.registrar'),
    ('cliente_web','tienda.catalogo.ver'), ('cliente_web','tienda.checkout.crear'), ('cliente_web','tienda.pedido.seguimiento'),
    ('supervisor_ventas','pedidos.pedido.aprobar'), ('supervisor_ventas','pedidos.pedido.cancelar'),
    ('supervisor_ventas','pedidos.pedido.crear'), ('supervisor_ventas','pedidos.pedido.confirmar'), ('supervisor_ventas','reportes.ver'),
    ('bodeguero','compras.recepcion.registrar'), ('bodeguero','despacho.despacho.gestionar'),
    ('bodeguero','inventarios.conteo.registrar'), ('bodeguero','inventarios.existencia.ver'),
    ('planificador_produccion','fabricacion.orden.liberar'), ('planificador_produccion','fabricacion.orden.programar'),
    ('planificador_produccion','fabricacion.orden.reportar'), ('planificador_produccion','inventarios.existencia.ver'),
    ('cajero','caja.sesion.abrir'), ('cajero','caja.sesion.cerrar'), ('cajero','caja.cobro.registrar'),
    ('cajero','caja.arqueo.realizar'), ('cajero','caja.movimiento.reversar'),
    ('contador','facturacion.factura.emitir'), ('contador','facturacion.factura.anular'),
    ('contador','facturacion.conciliacion.realizar'), ('contador','facturacion.cartera.ver'), ('contador','reportes.ver'),
    ('comprador','compras.proveedor.gestionar'), ('comprador','compras.orden.crear'),
    ('comprador','compras.orden.aprobar'), ('comprador','inventarios.existencia.ver')
  ) v(rol, permiso)
  JOIN seguridad.rol r ON r.codigo = v.rol
  JOIN seguridad.permiso p ON p.codigo = v.permiso
ON CONFLICT DO NOTHING;

-- El administrador gestiona usuarios, roles y catálogos (más todos los permisos de consulta)
INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM seguridad.rol r CROSS JOIN seguridad.permiso p
 WHERE r.codigo = 'administrador'
ON CONFLICT DO NOTHING;
