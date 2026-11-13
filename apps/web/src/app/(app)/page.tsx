'use client';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { ChipRegla, Encabezado, Indicador, Insignia, Panel, Vacio, Barra } from '@/componentes/ui';
import { IcCamion, IcCaja, IcFabrica, IcFactura, IcInventario, IcPedidos, IcFlecha } from '@/componentes/iconos';
import { cantidad, dinero, fecha, numeroFactura, plural } from '@/lib/formato';
import { serieDias } from '@/lib/series';
import { ESTADO_PEDIDO } from '@/lib/estados';
import { useSesion } from '@/componentes/Sesion';

const REGLAS: [string, string][] = [
  ['R1', 'Sin stock → fabricación'], ['R2', 'Reservado + fabricar ≤ pedido'], ['R3', 'Reserva ≤ stock físico'],
  ['R4', 'Una OF por línea'], ['R5', 'Kardex inmutable'], ['R6', 'Facturas no se borran'], ['R7', 'Saldo = total − pagos'],
  ['R8', 'Una caja abierta'], ['R9', 'Reversos, no ediciones'], ['R10', 'Solo token, nunca PAN'], ['R11', 'OC cierra con recepción'],
  ['R12', 'Despacho con reserva'], ['R13', 'Límite de crédito'], ['R14', 'Numeración sin saltos'],
];

export default function Inicio() {
  const { perfil } = useSesion();
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), [], []);
  const facturas = useLiveQuery(() => db.facturas.toArray(), [], []);
  const existencias = useLiveQuery(() => db.existencias.toArray(), [], []);
  const ofs = useLiveQuery(() => db.ordenes_fabricacion.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes_credito.toArray(), [], []);
  const despachos = useLiveQuery(() => db.despachos.toArray(), [], []);
  const articulos = useLiveQuery(() => db.articulos.toArray(), [], []);

  const vivas = facturas.filter(f => f.estado !== 'ANULADA');
  const hoyTxt = new Date().toDateString();
  const ventasHoy = vivas.filter(f => new Date(f.fecha_emision).toDateString() === hoyTxt).reduce((s, f) => s + Number(f.total), 0);
  const ventasSerie = serieDias(vivas, f => f.fecha_emision, f => Number(f.total));
  const cartera = vivas.reduce((s, f) => s + Number(f.saldo), 0);
  const enCurso = pedidos.filter(p => ['PENDIENTE_APROBACION', 'CONFIRMADO'].includes(p.estado));
  const porAprobar = pedidos.filter(p => p.estado === 'PENDIENTE_APROBACION').length;
  const pedidosSerie = serieDias(pedidos, p => p.creado_en, () => 1);
  const ofActivas = ofs.filter(o => ['PLANIFICADA', 'LIBERADA', 'EN_PROCESO'].includes(o.estado));
  const enRuta = despachos.filter(d => d.estado === 'DESPACHADO').length;
  const sinStock = existencias.filter(e => Number(e.cantidad_fisica) - Number(e.cantidad_reservada) <= 0).length;
  const nombreArt = (id: string) => articulos.find(a => a.id === id)?.nombre ?? '—';

  const recientes = [...pedidos].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))).slice(0, 6);
  const creditos = [...clientes].filter(c => Number(c.limite_credito) > 0)
    .sort((a, b) => Number(b.credito_usado) / Number(b.limite_credito) - Number(a.credito_usado) / Number(a.limite_credito)).slice(0, 4);

  return (
    <>
      <Encabezado titulo="Menú principal" detalle={`Resumen de la operación de hoy, ${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}. Todo se calcula con los datos de este dispositivo.`}
        acciones={<Link href="/pedidos?nuevo=1" className="btn btn-primario"><IcPedidos width={16} height={16} />Nuevo pedido</Link>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador titulo="Ventas de hoy" valor={dinero(ventasHoy)} serie={ventasSerie} tono="verde" icono={<IcFactura width={15} height={15} />} nota="Facturas emitidas, últimos 7 días" />
        <Indicador titulo="Pedidos en curso" valor={enCurso.length} serie={pedidosSerie} tono="azul" icono={<IcPedidos width={15} height={15} />}
          nota={porAprobar ? `${porAprobar} esperan aprobación del supervisor` : 'Ninguno espera aprobación'} />
        <Indicador titulo="Cartera pendiente" valor={dinero(cartera)} tono="ambar" icono={<IcCaja width={15} height={15} />} nota={`${plural(vivas.filter(f => Number(f.saldo) > 0).length, 'factura', 'facturas')} con saldo`} />
        <Indicador titulo="Fabricación activa" valor={ofActivas.length} tono="violeta" icono={<IcFabrica width={15} height={15} />}
          nota={`${plural(enRuta, 'despacho', 'despachos')} en ruta · ${plural(sinStock, 'artículo', 'artículos')} sin disponible`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel titulo="Pedidos recientes" detalle="Los últimos creados o sincronizados" className="xl:col-span-2" cuerpo={false}
          acciones={<Link href="/pedidos" className="btn btn-sm">Ver todos<IcFlecha width={14} height={14} /></Link>}>
          {recientes.length === 0 ? <Vacio icono={<IcPedidos />} titulo="Aún no hay pedidos" detalle="Cree el primero y aparecerá aquí, incluso sin conexión." accion={<Link href="/pedidos?nuevo=1" className="btn btn-primario btn-sm">Crear pedido</Link>} /> : (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="tabla">
                <thead><tr><th>Pedido</th><th>Estado</th><th className="num">Total</th><th>Creado</th></tr></thead>
                <tbody>{recientes.map(p => {
                  const e = ESTADO_PEDIDO[p.estado] ?? { texto: p.estado, tono: 'gris' as const };
                  return (<tr key={p.id}>
                    <td className="font-medium">{p.numero ?? 'Borrador'}</td>
                    <td><Insignia tono={e.tono} punto>{e.texto}</Insignia></td>
                    <td className="num">{dinero(p.total)}</td>
                    <td className="text-suave">{fecha(p.creado_en, true)}</td>
                  </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel titulo="Crédito de clientes" detalle="Mayor uso del límite (R13)">
          {creditos.length === 0 ? <p className="text-sm text-suave">Ningún cliente tiene límite de crédito asignado.</p> : (
            <ul className="space-y-4">{creditos.map(c => {
              const pct = Number(c.credito_usado) / Number(c.limite_credito);
              return (<li key={c.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{c.razon_social}</span>
                  {c.bloqueado ? <Insignia tono="rojo">Bloqueado</Insignia> : <span className="tabular-nums text-suave">{Math.round(pct * 100)}%</span>}
                </div>
                <Barra valor={Number(c.credito_usado)} max={Number(c.limite_credito)} tono={pct >= 1 ? 'rojo' : pct >= 0.8 ? 'ambar' : 'verde'} />
                <p className="mt-1 text-xs text-suave">{dinero(c.credito_usado)} de {dinero(c.limite_credito)}</p>
              </li>);
            })}</ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel titulo="Órdenes de fabricación" detalle="Generadas automáticamente por falta de stock (R1)" cuerpo={false}
          acciones={<Link href="/inventarios" className="btn btn-sm">Abrir</Link>}>
          {ofActivas.length === 0 ? <Vacio icono={<IcFabrica />} titulo="Sin órdenes activas" detalle="Cuando un pedido supere el stock, la orden aparece aquí." /> : (
            <ul className="divide-y divide-borde">{ofActivas.slice(0, 5).map(o => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">{o.numero} · {nombreArt(o.articulo_id)}</p>
                  <p className="text-xs text-suave">{cantidad(o.cantidad_producida)} de {cantidad(o.cantidad)} producidas</p></div>
                <Insignia tono={o.estado === 'PLANIFICADA' ? 'gris' : 'violeta'}>{o.estado.toLowerCase().replace('_', ' ')}</Insignia>
              </li>))}</ul>
          )}
        </Panel>

        <Panel titulo="Últimas facturas" detalle="Numeración consecutiva (R14)" cuerpo={false} acciones={<Link href="/facturacion" className="btn btn-sm">Abrir</Link>}>
          {vivas.length === 0 ? <Vacio icono={<IcFactura />} titulo="Sin facturas" detalle="Facture un pedido confirmado desde Facturación." /> : (
            <ul className="divide-y divide-borde">{[...vivas].sort((a, b) => String(b.fecha_emision).localeCompare(String(a.fecha_emision))).slice(0, 5).map(f => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div><p className="font-medium">{numeroFactura(f)}</p><p className="text-xs text-suave">{fecha(f.fecha_emision)}</p></div>
                <div className="text-right"><p className="tabular-nums">{dinero(f.total)}</p>
                  {Number(f.saldo) > 0 ? <p className="text-xs text-ambar">Saldo {dinero(f.saldo)}</p> : <p className="text-xs text-verde">Pagada</p>}</div>
              </li>))}</ul>
          )}
        </Panel>

        <Panel titulo="Despachos" detalle="Mercancía con reserva activa (R12)" cuerpo={false} acciones={<Link href="/despacho" className="btn btn-sm">Abrir</Link>}>
          {despachos.length === 0 ? <Vacio icono={<IcCamion />} titulo="Sin despachos" detalle="Los pedidos confirmados con reserva aparecerán listos para despachar." /> : (
            <ul className="divide-y divide-borde">{[...despachos].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))).slice(0, 5).map(d => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div><p className="font-medium">{d.numero ?? 'Despacho'}</p><p className="text-xs text-suave">{d.guia ? `Guía ${d.guia}` : 'Sin guía'}</p></div>
                <Insignia tono={d.estado === 'ENTREGADO' ? 'verde' : d.estado === 'FALLIDO' ? 'rojo' : 'azul'} punto>{d.estado.toLowerCase()}</Insignia>
              </li>))}</ul>
          )}
        </Panel>
      </div>

      <Panel titulo="Reglas de negocio vigentes" detalle="Las valida el dominio y la base de datos, no solo la pantalla" className="mt-4">
        <div className="flex flex-wrap gap-2">{REGLAS.map(([r, t]) => <ChipRegla key={r} r={r}>{t}</ChipRegla>)}</div>
      </Panel>
      {perfil && <p className="mt-6 text-xs text-suave"><IcInventario className="mr-1 inline" width={13} height={13} />Roles: {perfil.roles.join(', ') || 'sin rol'}.</p>}
    </>
  );
}
