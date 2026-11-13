// src/features/pedidos/ListaPedidos.tsx
'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { confirmarPedido } from '@/offline/repos/pedidos';
import { Insignia, Modal, Panel, Vacio, useDialogos } from '@/componentes/ui';
import { IcBuscar, IcPedidos } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { cantidad, dinero, fecha } from '@/lib/formato';
import { ESTADO_PEDIDO } from '@/lib/estados';

const FILTROS = [['', 'Todos'], ['BORRADOR', 'Borradores'], ['PENDIENTE_APROBACION', 'Por aprobar'], ['CONFIRMADO', 'Confirmados'], ['DESPACHADO', 'Despachados']] as const;

export function ListaPedidos() {
  const { puede, online } = useSesion();
  const { avisar, confirmar } = useDialogos();
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), [], []);
  const lineas = useLiveQuery(() => db.pedido_lineas.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes.toArray(), [], []);
  const [filtro, setFiltro] = useState('');
  const [texto, setTexto] = useState('');
  const [verId, setVerId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cliente = (id: string) => clientes.find(c => c.id === id)?.razon_social ?? '—';
  const lineasDe = (id: string) => lineas.filter(l => l.pedido_id === id && !l.eliminado_en);
  const lista = useMemo(() => pedidos
    .filter(p => (!filtro || p.estado === filtro) && (!texto || `${p.numero ?? ''} ${cliente(p.cliente_id)}`.toLowerCase().includes(texto.toLowerCase())))
    .sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))), // eslint-disable-next-line react-hooks/exhaustive-deps
    [pedidos, clientes, filtro, texto]);
  const ver = pedidos.find(p => p.id === verId);

  async function accion(id: string, ruta: 'aprobar' | 'cancelar', ok: string) {
    if (ruta === 'cancelar' && !(await confirmar({ titulo: 'Cancelar pedido', detalle: 'Se liberarán las reservas de stock. Esta acción no se puede deshacer.', confirmar: 'Cancelar pedido', peligro: true }))) return;
    setOcupado(id);
    try { await api(`/pedidos/${id}/${ruta}`, { method: 'POST' }); avisar(ok, 'ok'); await solicitarSync(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
    finally { setOcupado(null); }
  }

  return (
    <Panel cuerpo={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-borde p-4">
        <div className="relative min-w-52 flex-1">
          <IcBuscar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-suave" width={15} height={15} />
          <input className="campo !pl-9" placeholder="Buscar por número o cliente" value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar pedidos" />
        </div>
        <div className="flex flex-wrap gap-1.5">{FILTROS.map(([v, t]) => (
          <button key={v} onClick={() => setFiltro(v)} aria-pressed={filtro === v}
            className={`btn btn-sm ${filtro === v ? '!border-azul/50 !bg-azul/15' : ''}`}>{t}</button>))}</div>
      </div>

      {lista.length === 0 ? <Vacio icono={<IcPedidos />} titulo="No hay pedidos con este filtro" detalle="Cambie el filtro o cree un pedido nuevo." /> : (
        <div className="overflow-x-auto px-2 pb-2">
          <table className="tabla min-w-[46rem]">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Abastecimiento</th><th className="num">Total</th><th /></tr></thead>
            <tbody>{lista.map(p => {
              const ls = lineasDe(p.id);
              const reservado = ls.reduce((s, l) => s + Number(l.cantidad_reservada), 0);
              const fabricar = ls.reduce((s, l) => s + Number(l.cantidad_a_fabricar), 0);
              const e = ESTADO_PEDIDO[p.estado] ?? { texto: p.estado, tono: 'gris' as const };
              return (
                <tr key={p.id}>
                  <td><button className="text-left font-medium hover:underline" onClick={() => setVerId(p.id)}>{p.numero ?? 'Borrador'}</button>
                    <p className="text-xs text-suave">{fecha(p.creado_en, true)}{p._local || p._confirmando ? ' · por sincronizar' : ''}</p></td>
                  <td>{cliente(p.cliente_id)}<p className="text-xs text-suave">{p.canal?.toLowerCase()} · {p.condicion_pago?.toLowerCase()}</p></td>
                  <td><Insignia tono={p._confirmando ? 'azul' : e.tono} punto>{p._confirmando ? 'Confirmando…' : e.texto}</Insignia>
                    {p.motivo_rechazo && <p className="mt-1 max-w-48 text-xs text-rojo">{p.motivo_rechazo}</p>}</td>
                  <td className="text-sm">{['CONFIRMADO', 'DESPACHADO'].includes(p.estado)
                    ? <span className="text-suave">{cantidad(reservado)} reservado{fabricar > 0 && <span className="ml-1 text-violeta">· {cantidad(fabricar)} a fabricar</span>}</span> : <span className="text-suave">—</span>}</td>
                  <td className="num font-medium">{dinero(p.total)}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      {p.estado === 'BORRADOR' && !p._confirmando && <button className="btn btn-sm btn-primario" onClick={() => confirmarPedido(p.id)}>Confirmar</button>}
                      {p.estado === 'PENDIENTE_APROBACION' && puede('pedidos.pedido.aprobar') && <button className="btn btn-sm btn-exito" disabled={!online || ocupado === p.id} title={online ? '' : 'Requiere conexión'} onClick={() => accion(p.id, 'aprobar', 'Pedido aprobado')}>Aprobar</button>}
                      {['PENDIENTE_APROBACION', 'CONFIRMADO'].includes(p.estado) && puede('pedidos.pedido.cancelar') && <button className="btn btn-sm btn-peligro" disabled={!online || ocupado === p.id} title={online ? '' : 'Requiere conexión'} onClick={() => accion(p.id, 'cancelar', 'Pedido cancelado')}>Cancelar</button>}
                      {p.estado === 'CONFIRMADO' && !p.factura_id && <Link className="btn btn-sm" href={`/facturacion?pedido=${p.id}`}>Facturar</Link>}
                    </div>
                  </td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}

      <Modal abierto={!!ver} onCerrar={() => setVerId(null)} titulo={`Pedido ${ver?.numero ?? 'en borrador'}`} ancho="max-w-2xl" pie={<button className="btn" onClick={() => setVerId(null)}>Cerrar</button>}>
        {ver && <>
          <p className="text-sm text-suave">{cliente(ver.cliente_id)} · {fecha(ver.creado_en, true)}</p>
          <div className="overflow-x-auto"><table className="tabla">
            <thead><tr><th>Artículo</th><th className="num">Cant.</th><th className="num">Reservado</th><th className="num">A fabricar</th><th className="num">Total</th></tr></thead>
            <tbody>{lineasDe(ver.id).map(l => (
              <tr key={l.id}><td>{l.descripcion}</td><td className="num">{cantidad(l.cantidad)}</td><td className="num">{cantidad(l.cantidad_reservada)}</td>
                <td className="num">{cantidad(l.cantidad_a_fabricar)}</td><td className="num">{dinero(l.total_linea ?? Number(l.cantidad) * Number(l.precio_unitario))}</td></tr>))}</tbody>
          </table></div>
        </>}
      </Modal>
    </Panel>
  );
}
