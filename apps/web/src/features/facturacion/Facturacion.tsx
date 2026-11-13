// src/features/facturacion/Facturacion.tsx
'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { nuevoId } from '@/offline/repos/pedidos';
import { Aviso, Barra, Campo, ChipRegla, Encabezado, Indicador, Insignia, Panel, Pestanas, Vacio, useDialogos } from '@/componentes/ui';
import { IcFactura, IcCaja, IcAlerta } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { dinero, fecha, numeroFactura } from '@/lib/formato';
import { ESTADO_FACTURA } from '@/lib/estados';

interface FilaCartera { id: string; factura: string; total: string; saldo: string; fecha_vencimiento: string; dias_mora: number; cliente_id: string }

export function Facturacion() {
  const { puede, online } = useSesion();
  const { avisar, pedirMotivo } = useDialogos();
  const facturas = useLiveQuery(() => db.facturas.toArray(), [], []);
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes.toArray(), [], []);

  const [vista, setVista] = useState<'facturas' | 'cartera'>('facturas');
  const [pedidoId, setPedidoId] = useState('');
  const [prefijo, setPrefijo] = useState('F');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soloVencida, setSoloVencida] = useState(false);
  const [cartera, setCartera] = useState<FilaCartera[] | null>(null);
  const [errCartera, setErrCartera] = useState<string | null>(null);

  useEffect(() => { const p = new URLSearchParams(window.location.search).get('pedido'); if (p) setPedidoId(p); }, []);
  useEffect(() => {
    if (vista !== 'cartera') return;
    setCartera(null); setErrCartera(null);
    api<FilaCartera[]>(`/cartera?vencida=${soloVencida}`).then(setCartera).catch(e => setErrCartera(mensajeError(e)));
  }, [vista, soloVencida, facturas.length]);

  const cliente = (id: string) => clientes.find(c => c.id === id)?.razon_social ?? '—';
  const porFacturar = pedidos.filter(p => p.estado === 'CONFIRMADO' && !p.factura_id && !facturas.some(f => f.pedido_id === p.id && f.estado !== 'ANULADA'));
  const elegido = porFacturar.find(p => p.id === pedidoId);

  const vivas = facturas.filter(f => f.estado !== 'ANULADA');
  const hoy = new Date().toISOString().slice(0, 10);
  const mes = new Date().toISOString().slice(0, 7);
  const facturadoMes = vivas.filter(f => String(f.fecha_emision).startsWith(mes)).reduce((s, f) => s + Number(f.total), 0);
  const saldo = vivas.reduce((s, f) => s + Number(f.saldo), 0);
  const vencidas = vivas.filter(f => Number(f.saldo) > 0 && String(f.fecha_vencimiento) < hoy);
  const lista = useMemo(() => [...facturas].sort((a, b) => Number(b.numero) - Number(a.numero)), [facturas]);

  async function emitir() {
    if (!elegido) return;
    setOcupado(true); setError(null);
    try {
      await api('/facturas', { method: 'POST', body: JSON.stringify({ facturaId: nuevoId(), pedidoId: elegido.id, prefijo: prefijo.trim() }) });
      avisar('Factura emitida', 'ok'); setPedidoId(''); await solicitarSync();
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  }

  async function anular(id: string, nombre: string) {
    const motivo = await pedirMotivo({
      titulo: `Anular ${nombre}`, detalle: 'La factura no se borra: se emite una nota crédito que cancela su saldo (R6).',
      confirmar: 'Emitir nota crédito', peligro: true,
    });
    if (!motivo) return;
    try {
      await api(`/facturas/${id}/anular`, { method: 'POST', body: JSON.stringify({ notaId: nuevoId(), prefijoNc: 'NC', motivo }) });
      avisar('Nota crédito emitida', 'ok'); await solicitarSync();
    } catch (e) { avisar(mensajeError(e), 'error'); }
  }

  return (
    <>
      <Encabezado titulo="Facturación" detalle="Emita facturas de pedidos confirmados, siga el saldo y anule con nota crédito."
        reglas={<><ChipRegla r="R6">no se borra</ChipRegla><ChipRegla r="R7">saldo</ChipRegla><ChipRegla r="R14">sin saltos</ChipRegla></>}
        acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[{ id: 'facturas', texto: 'Facturas', cuenta: facturas.length }, { id: 'cartera', texto: 'Cartera' }]} />} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Facturado este mes" valor={dinero(facturadoMes)} tono="verde" icono={<IcFactura width={15} height={15} />} />
        <Indicador titulo="Saldo por cobrar" valor={dinero(saldo)} tono="ambar" icono={<IcCaja width={15} height={15} />} nota="Total menos pagos aplicados (R7)" />
        <Indicador titulo="Facturas vencidas" valor={vencidas.length} tono={vencidas.length ? 'rojo' : 'verde'} icono={<IcAlerta width={15} height={15} />} nota={vencidas.length ? dinero(vencidas.reduce((s, f) => s + Number(f.saldo), 0)) + ' en mora' : 'Cartera al día'} />
      </div>

      <Panel titulo="Emitir factura" detalle="Solo pedidos confirmados que aún no tienen factura" className="mb-4">
        {!puede('facturacion.factura.emitir') ? <Aviso tono="ambar">Su rol no puede emitir facturas.</Aviso> : (
          <div className="grid items-end gap-3 md:grid-cols-[2fr_9rem_1fr_auto]">
            <Campo etiqueta="Pedido">
              <select className="campo" value={pedidoId} onChange={e => setPedidoId(e.target.value)}>
                <option value="">{porFacturar.length ? 'Seleccione un pedido…' : 'No hay pedidos por facturar'}</option>
                {porFacturar.map(p => <option key={p.id} value={p.id}>{p.numero} · {cliente(p.cliente_id)} · {dinero(p.total)}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Prefijo">
              <input className="campo" value={prefijo} maxLength={6} onChange={e => setPrefijo(e.target.value.toUpperCase())} />
            </Campo>
            <div className="pb-2 text-sm">{elegido ? <><span className="text-suave">Total a facturar</span> <b className="ml-1 tabular-nums">{dinero(elegido.total)}</b></> : <span className="text-suave">El consecutivo lo asigna el servidor, sin saltos (R14).</span>}</div>
            <button className="btn btn-primario" disabled={!elegido || !prefijo.trim() || !online || ocupado} onClick={emitir}>{ocupado ? 'Emitiendo…' : 'Emitir factura'}</button>
          </div>)}
        {error && <div className="mt-3"><Aviso tono="rojo">{error}</Aviso></div>}
        {!online && <p className="mt-2 text-xs text-ambar">Emitir requiere conexión para reservar el número consecutivo.</p>}
      </Panel>

      <div>
        {vista === 'facturas' ? (
          <Panel titulo="Facturas" cuerpo={false}>
            {lista.length === 0 ? <Vacio icono={<IcFactura />} titulo="Aún no hay facturas" detalle="Elija un pedido confirmado y emítala desde el panel de la izquierda." /> : (
              <div className="overflow-x-auto px-2 pb-2">
                <table className="tabla min-w-[48rem]">
                  <thead><tr><th>Factura</th><th>Cliente</th><th>Vence</th><th className="num">Total</th><th className="w-40">Saldo</th><th>Estado</th><th /></tr></thead>
                  <tbody>{lista.map(f => {
                    const e = ESTADO_FACTURA[f.estado] ?? { texto: f.estado, tono: 'gris' as const };
                    const mora = f.estado !== 'ANULADA' && Number(f.saldo) > 0 && String(f.fecha_vencimiento) < hoy;
                    const nombre = numeroFactura(f);
                    return (
                      <tr key={f.id}>
                        <td className="nowrap"><p className="font-medium">{nombre}</p><p className="text-xs text-suave">{fecha(f.fecha_emision)}</p></td>
                        <td>{cliente(f.cliente_id)}</td>
                        <td className={`nowrap ${mora ? 'text-rojo' : 'text-suave'}`}>{fecha(f.fecha_vencimiento)}</td>
                        <td className="num">{dinero(f.total)}</td>
                        <td><p className="text-right text-xs tabular-nums">{dinero(f.saldo)}</p><Barra valor={Number(f.total) - Number(f.saldo)} max={Number(f.total)} tono="verde" /></td>
                        <td><Insignia tono={mora ? 'rojo' : e.tono} punto>{mora ? 'Vencida' : e.texto}</Insignia></td>
                        <td><div className="flex justify-end gap-1.5">
                          {Number(f.saldo) > 0 && f.estado !== 'ANULADA' && <Link className="btn btn-sm" href={`/caja?factura=${f.id}`}>Cobrar</Link>}
                          {f.estado !== 'ANULADA' && puede('facturacion.factura.anular') && <button className="btn btn-sm btn-peligro" disabled={!online} title={online ? '' : 'Requiere conexión'} onClick={() => anular(f.id, nombre)}>Anular</button>}
                        </div></td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : (
          <Panel titulo="Cartera pendiente" detalle="Consulta en línea de facturas con saldo"
            acciones={<label className="flex items-center gap-2 text-sm text-suave"><input type="checkbox" checked={soloVencida} onChange={e => setSoloVencida(e.target.checked)} />Solo vencidas</label>} cuerpo={false}>
            {errCartera ? <div className="p-4"><Aviso tono="ambar">{errCartera}</Aviso></div>
              : !cartera ? <p className="p-6 text-sm text-suave">Consultando…</p>
              : cartera.length === 0 ? <Vacio titulo="Sin cartera pendiente" detalle="No hay facturas con saldo para este filtro." /> : (
              <div className="overflow-x-auto px-2 pb-2"><table className="tabla">
                <thead><tr><th>Factura</th><th>Cliente</th><th>Vence</th><th className="num">Mora</th><th className="num">Saldo</th></tr></thead>
                <tbody>{cartera.map(c => (
                  <tr key={c.id}><td className="font-medium">{c.factura}</td><td>{cliente(c.cliente_id)}</td><td className="text-suave">{fecha(c.fecha_vencimiento)}</td>
                    <td className="num">{c.dias_mora > 0 ? <span className="text-rojo">{c.dias_mora} días</span> : <span className="text-suave">Al día</span>}</td>
                    <td className="num font-medium">{dinero(c.saldo)}</td></tr>))}</tbody>
              </table></div>)}
          </Panel>
        )}
      </div>
    </>
  );
}
