// src/features/despacho/Despacho.tsx
'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { despacharPedido, registrarEntrega, registrarEntregaFallida } from '@/offline/repos/despacho';
import { Aviso, Campo, ChipRegla, Encabezado, Indicador, Insignia, Panel, Vacio, useDialogos } from '@/componentes/ui';
import { IcCamion, IcCheck, IcAlerta } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { cantidad, dinero, fecha } from '@/lib/formato';
import { ESTADO_DESPACHO } from '@/lib/estados';

export function Despacho() {
  const { puede, online } = useSesion();
  const { avisar, pedirMotivo } = useDialogos();
  const pedidos = useLiveQuery(() => db.pedidos.where('estado').equals('CONFIRMADO').toArray(), [], []);
  const lineas = useLiveQuery(() => db.pedido_lineas.toArray(), [], []);
  const despachos = useLiveQuery(() => db.despachos.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes.toArray(), [], []);
  const bodegas = useLiveQuery(() => db.bodegas.toArray(), [], []);

  const [elegido, setElegido] = useState<string | null>(null);
  const [excluidas, setExcluidas] = useState<Set<string>>(new Set());
  const [transp, setTransp] = useState(''); const [guia, setGuia] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cliente = (id: string) => clientes.find(c => c.id === id)?.razon_social ?? '—';
  const lineasDe = (id: string) => lineas.filter(l => l.pedido_id === id && !l.eliminado_en);
  const vigentes = new Set(despachos.filter(d => d.estado !== 'CANCELADO').map(d => d.pedido_id));
  const pendientes = pedidos.filter(p => !vigentes.has(p.id)).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
  const conReserva = (id: string) => lineasDe(id).some(l => Number(l.cantidad_reservada) > 0);
  const completa = (id: string) => lineasDe(id).every(l => Number(l.cantidad_reservada) >= Number(l.cantidad));

  const pedido = pendientes.find(p => p.id === elegido);
  const lsPedido = pedido ? lineasDe(pedido.id) : [];
  const despachables = lsPedido.filter(l => Number(l.cantidad_reservada) > 0 && !excluidas.has(l.id));

  const enRuta = despachos.filter(d => d.estado === 'DESPACHADO').length;
  const fallidos = despachos.filter(d => d.estado === 'FALLIDO').length;
  const entregados = despachos.filter(d => d.estado === 'ENTREGADO').length;

  async function despachar() {
    if (!pedido || despachables.length === 0) return;
    setEnviando(true);
    try {
      await despacharPedido({
        pedidoId: pedido.id, transportador: transp.trim() || undefined, guia: guia.trim() || undefined,
        pedidoLineaIds: despachables.length === lsPedido.length ? undefined : despachables.map(l => l.id),
      });
      avisar('Despacho registrado. El servidor valida la reserva al sincronizar (R12).', 'ok');
      setElegido(null); setGuia(''); setExcluidas(new Set());
    } finally { setEnviando(false); }
  }

  async function entregar(id: string) {
    const receptor = await pedirMotivo({ titulo: 'Confirmar entrega', etiqueta: 'Nombre de quien recibe', minimo: 3, confirmar: 'Confirmar entrega' });
    if (receptor) { await registrarEntrega({ despachoId: id, receptor }); avisar('Entrega registrada', 'ok'); }
  }
  async function fallo(id: string) {
    const motivo = await pedirMotivo({ titulo: 'Entrega fallida', etiqueta: 'Motivo', confirmar: 'Registrar fallo', peligro: true });
    if (motivo) { await registrarEntregaFallida({ despachoId: id, motivo }); avisar('Fallo registrado', 'info'); }
  }
  async function reintentar(id: string) {
    try { await api(`/despachos/${id}/reintentar`, { method: 'POST' }); avisar('Entrega reprogramada', 'ok'); await solicitarSync(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
  }

  return (
    <>
      <Encabezado titulo="Despacho de mercancía" detalle="Solo sale mercancía que tenga una reserva de stock activa. El servidor lo confirma al sincronizar."
        reglas={<><ChipRegla r="R12">despacho con reserva</ChipRegla><ChipRegla r="R3" /></>} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador titulo="Listos para despachar" valor={pendientes.length} tono="azul" icono={<IcCamion width={15} height={15} />} />
        <Indicador titulo="En ruta" valor={enRuta} tono="violeta" />
        <Indicador titulo="Entregados" valor={entregados} tono="verde" icono={<IcCheck width={15} height={15} />} />
        <Indicador titulo="Entregas fallidas" valor={fallidos} tono={fallidos ? 'rojo' : 'verde'} icono={<IcAlerta width={15} height={15} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel titulo="Pedidos con reserva" detalle="Elija uno para ver sus líneas y registrar el despacho" cuerpo={false}>
          {pendientes.length === 0 ? <Vacio icono={<IcCamion />} titulo="No hay pedidos por despachar" detalle="Aparecen aquí los pedidos confirmados que todavía no tienen despacho." /> : (
            <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[38rem]">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Bodega</th><th>Reserva</th><th className="num">Total</th></tr></thead>
              <tbody>{pendientes.map(p => {
                const ok = completa(p.id), algo = conReserva(p.id);
                return (<tr key={p.id} className={`cursor-pointer ${elegido === p.id ? 'bg-azul/10' : ''}`} onClick={() => { setElegido(p.id); setExcluidas(new Set()); }}>
                  <td><button className="nowrap text-left font-medium" aria-pressed={elegido === p.id}>{p.numero ?? p.id.slice(0, 8)}</button><p className="text-xs text-suave">{fecha(p.creado_en)}</p></td>
                  <td>{cliente(p.cliente_id)}</td>
                  <td className="text-suave">{bodegas.find(b => b.id === p.bodega_id)?.nombre ?? '—'}</td>
                  <td>{ok ? <Insignia tono="verde" punto>Reserva activa</Insignia> : algo ? <Insignia tono="ambar" punto>Reserva parcial</Insignia> : <Insignia tono="rojo" punto>Sin reserva</Insignia>}</td>
                  <td className="num">{dinero(p.total)}</td>
                </tr>);
              })}</tbody>
            </table></div>)}
        </Panel>

        <Panel titulo="Registrar despacho" detalle={pedido ? `${pedido.numero ?? ''} · ${cliente(pedido.cliente_id)}` : 'Seleccione un pedido'}>
          {!pedido ? <p className="text-sm text-suave">Al elegir un pedido verá aquí qué líneas pueden salir.</p> : (
            <div className="space-y-3">
              <ul className="divide-y divide-borde rounded-lg border border-borde">{lsPedido.map(l => {
                const reservada = Number(l.cantidad_reservada) > 0;
                return (<li key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <input type="checkbox" aria-label={`Despachar ${l.descripcion}`} disabled={!reservada} checked={reservada && !excluidas.has(l.id)}
                    onChange={e => setExcluidas(s => { const n = new Set(s); e.target.checked ? n.delete(l.id) : n.add(l.id); return n; })} />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{l.descripcion}</p>
                    <p className="text-xs text-suave">{cantidad(l.cantidad_reservada)} reservado de {cantidad(l.cantidad)}</p></div>
                  {!reservada && <Insignia tono="rojo">Sin reserva</Insignia>}
                </li>);
              })}</ul>
              {despachables.length === 0 && <Aviso tono="rojo">Ninguna línea tiene reserva activa, por eso no se puede despachar (R12).</Aviso>}
              <Campo etiqueta="Transportador"><input className="campo" value={transp} onChange={e => setTransp(e.target.value)} /></Campo>
              <Campo etiqueta="Número de guía"><input className="campo" value={guia} onChange={e => setGuia(e.target.value)} /></Campo>
              <button className="btn btn-primario btn-bloque" disabled={despachables.length === 0 || enviando || !puede('despacho.despacho.gestionar')} onClick={despachar}>
                <IcCamion width={16} height={16} />Despachar {despachables.length} {despachables.length === 1 ? 'línea' : 'líneas'}
              </button>
              <p className="text-xs text-suave">Funciona sin conexión: si la reserva venció, el servidor lo rechazará y lo verá en los avisos.</p>
            </div>)}
        </Panel>
      </div>

      <Panel titulo="Seguimiento de despachos" className="mt-4" cuerpo={false}>
        {despachos.length === 0 ? <Vacio icono={<IcCamion />} titulo="Aún no hay despachos" /> : (
          <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[44rem]">
            <thead><tr><th>Despacho</th><th>Transporte</th><th>Estado</th><th /></tr></thead>
            <tbody>{[...despachos].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))).slice(0, 50).map(d => {
              const e = ESTADO_DESPACHO[d.estado] ?? { texto: d.estado, tono: 'gris' as const };
              return (<tr key={d.id}>
                <td><p className="font-medium">{d.numero ?? 'Por numerar'}</p><p className="text-xs text-suave">{fecha(d.creado_en, true)}{d._pendiente ? ' · por sincronizar' : ''}</p></td>
                <td>{d.transportador ?? '—'}<p className="text-xs text-suave">{d.guia ? `Guía ${d.guia}` : 'Sin guía'}</p></td>
                <td><Insignia tono={e.tono} punto>{e.texto}</Insignia>
                  {d.receptor && <p className="mt-1 text-xs text-suave">Recibió {d.receptor}</p>}
                  {d.motivo_fallo && <p className="mt-1 max-w-56 text-xs text-rojo">{d.motivo_fallo}</p>}</td>
                <td><div className="flex justify-end gap-1.5">
                  {d.estado === 'DESPACHADO' && <><button className="btn btn-sm btn-exito" onClick={() => entregar(d.id)}>Entregado</button><button className="btn btn-sm btn-peligro" onClick={() => fallo(d.id)}>Falló</button></>}
                  {d.estado === 'FALLIDO' && <button className="btn btn-sm" disabled={!online} title={online ? '' : 'Requiere conexión'} onClick={() => reintentar(d.id)}>Reintentar</button>}
                </div></td>
              </tr>);
            })}</tbody>
          </table></div>)}
      </Panel>
    </>
  );
}
