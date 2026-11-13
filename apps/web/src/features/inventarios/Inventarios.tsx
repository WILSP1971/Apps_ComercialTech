// src/features/inventarios/Inventarios.tsx — existencias y órdenes de fabricación
'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { liberarOrden, reportarProduccion } from '@/offline/repos/fabricacion';
import { Aviso, Barra, Campo, ChipRegla, Encabezado, Indicador, Insignia, Modal, Panel, Pestanas, Vacio, useDialogos } from '@/componentes/ui';
import { IcBuscar, IcFabrica, IcInventario } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { cantidad, fecha } from '@/lib/formato';
import { ESTADO_OF } from '@/lib/estados';

export function Inventarios() {
  const { puede } = useSesion();
  const { avisar } = useDialogos();
  const existencias = useLiveQuery(() => db.existencias.toArray(), [], []);
  const articulos = useLiveQuery(() => db.articulos.toArray(), [], []);
  const bodegas = useLiveQuery(() => db.bodegas.toArray(), [], []);
  const ordenes = useLiveQuery(() => db.ordenes_fabricacion.toArray(), [], []);

  const [vista, setVista] = useState<'existencias' | 'fabricacion'>('existencias');
  const [bodegaId, setBodegaId] = useState('');
  const [texto, setTexto] = useState('');
  const [reportar, setReportar] = useState<string | null>(null);
  const [cant, setCant] = useState(0);

  const art = (id: string) => articulos.find(a => a.id === id);
  const bod = (id: string) => bodegas.find(b => b.id === id);
  const filas = useMemo(() => existencias
    .filter(e => (!bodegaId || e.bodega_id === bodegaId) && (!texto || `${art(e.articulo_id)?.nombre ?? ''} ${art(e.articulo_id)?.sku ?? ''}`.toLowerCase().includes(texto.toLowerCase())))
    .sort((a, b) => (art(a.articulo_id)?.nombre ?? '').localeCompare(art(b.articulo_id)?.nombre ?? '')), // eslint-disable-next-line react-hooks/exhaustive-deps
    [existencias, articulos, bodegaId, texto]);

  const fisico = existencias.reduce((s, e) => s + Number(e.cantidad_fisica), 0);
  const reservado = existencias.reduce((s, e) => s + Number(e.cantidad_reservada), 0);
  const agotados = existencias.filter(e => Number(e.cantidad_fisica) - Number(e.cantidad_reservada) <= 0).length;
  const activas = ordenes.filter(o => ['PLANIFICADA', 'LIBERADA', 'EN_PROCESO'].includes(o.estado));
  const lista = [...ordenes].sort((a, b) => String(a.numero).localeCompare(String(b.numero)) * -1);
  const orden = ordenes.find(o => o.id === reportar);
  const pendiente = orden ? Number(orden.cantidad) - Number(orden.cantidad_producida) : 0;

  async function guardarReporte() {
    if (!orden || cant <= 0 || cant > pendiente) return;
    try { await reportarProduccion(orden.id, cant); avisar('Producción reportada', 'ok'); setReportar(null); setCant(0); }
    catch (e) { avisar((e as Error).message, 'error'); }
  }

  return (
    <>
      <Encabezado titulo="Inventarios y fabricación" detalle="Existencias por bodega y órdenes de fabricación que se abren solas cuando falta stock."
        reglas={<><ChipRegla r="R1" /><ChipRegla r="R3">reserva ≤ físico</ChipRegla><ChipRegla r="R4">una OF por línea</ChipRegla><ChipRegla r="R5">kardex inmutable</ChipRegla></>}
        acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[{ id: 'existencias', texto: 'Existencias', cuenta: existencias.length }, { id: 'fabricacion', texto: 'Fabricación', cuenta: activas.length }]} />} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador titulo="Unidades en bodega" valor={cantidad(fisico)} tono="azul" icono={<IcInventario width={15} height={15} />} />
        <Indicador titulo="Reservado a pedidos" valor={cantidad(reservado)} tono="violeta" nota={`${fisico ? Math.round((reservado / fisico) * 100) : 0}% del stock físico`} />
        <Indicador titulo="Sin disponible" valor={agotados} tono={agotados ? 'rojo' : 'verde'} nota={agotados ? 'Pueden generar fabricación o compra' : 'Todo tiene stock libre'} />
        <Indicador titulo="Órdenes activas" valor={activas.length} tono="ambar" icono={<IcFabrica width={15} height={15} />} />
      </div>

      {vista === 'existencias' ? (
        <Panel cuerpo={false}>
          <div className="flex flex-wrap items-center gap-3 border-b border-borde p-4">
            <div className="relative min-w-52 flex-1">
              <IcBuscar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-suave" width={15} height={15} />
              <input className="campo !pl-9" placeholder="Buscar por nombre o SKU" value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar existencias" />
            </div>
            <select className="campo !w-auto" value={bodegaId} onChange={e => setBodegaId(e.target.value)} aria-label="Bodega">
              <option value="">Todas las bodegas</option>{bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre ?? b.codigo}</option>)}
            </select>
          </div>
          {filas.length === 0 ? <Vacio icono={<IcInventario />} titulo="No hay existencias para mostrar" detalle="Cambie el filtro o espere a que termine la sincronización." /> : (
            <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[42rem]">
              <thead><tr><th>Artículo</th><th>Bodega</th><th className="num">Físico</th><th className="num">Reservado</th><th className="w-44">Disponible</th></tr></thead>
              <tbody>{filas.map(e => {
                const disp = Number(e.cantidad_fisica) - Number(e.cantidad_reservada);
                const a = art(e.articulo_id);
                return (<tr key={e.id}>
                  <td><p className="font-medium">{a?.nombre ?? '—'}</p><p className="text-xs text-suave">{a?.sku}{a?.es_fabricable ? ' · fabricable' : ''}</p></td>
                  <td>{bod(e.bodega_id)?.nombre ?? '—'}</td>
                  <td className="num">{cantidad(e.cantidad_fisica)}</td><td className="num">{cantidad(e.cantidad_reservada)}</td>
                  <td><div className="flex items-center justify-between gap-2"><span className={`text-sm font-medium tabular-nums ${disp <= 0 ? 'text-rojo' : ''}`}>{cantidad(disp)}</span>
                    {disp <= 0 && <Insignia tono="rojo">Agotado</Insignia>}</div>
                    <Barra valor={disp} max={Number(e.cantidad_fisica) || 1} tono={disp <= 0 ? 'rojo' : 'verde'} /></td>
                </tr>);
              })}</tbody>
            </table></div>)}
        </Panel>
      ) : (
        <Panel titulo="Órdenes de fabricación" detalle="Liberar y reportar funciona sin conexión" cuerpo={false}>
          {lista.length === 0 ? <Vacio icono={<IcFabrica />} titulo="No hay órdenes de fabricación" detalle="Se crean solas cuando un pedido pide más de lo que hay de un artículo fabricable." /> : (
            <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[44rem]">
              <thead><tr><th>Orden</th><th>Artículo</th><th className="w-48">Avance</th><th>Estado</th><th /></tr></thead>
              <tbody>{lista.map(o => {
                const e = ESTADO_OF[o.estado] ?? { texto: o.estado, tono: 'gris' as const };
                return (<tr key={o.id}>
                  <td><p className="font-medium">{o.numero}</p><p className="text-xs text-suave">{o.fecha_programada ? `Programada ${fecha(o.fecha_programada)}` : o.pedido_id ? 'Origen: pedido' : 'Manual'}</p></td>
                  <td>{art(o.articulo_id)?.nombre ?? '—'}</td>
                  <td><p className="text-xs tabular-nums text-suave">{cantidad(o.cantidad_producida)} de {cantidad(o.cantidad)}</p><Barra valor={Number(o.cantidad_producida)} max={Number(o.cantidad)} tono="violeta" /></td>
                  <td><Insignia tono={e.tono} punto>{e.texto}</Insignia>{o._pendiente && <p className="mt-1 text-xs text-ambar">por sincronizar</p>}</td>
                  <td><div className="flex justify-end gap-1.5">
                    {o.estado === 'PLANIFICADA' && <button className="btn btn-sm btn-primario" disabled={!puede('fabricacion.orden.liberar')} onClick={() => liberarOrden(o.id).then(() => avisar('Orden liberada', 'ok'))}>Liberar</button>}
                    {['LIBERADA', 'EN_PROCESO'].includes(o.estado) && <button className="btn btn-sm" disabled={!puede('fabricacion.orden.reportar')} onClick={() => { setReportar(o.id); setCant(0); }}>Reportar producción</button>}
                  </div></td>
                </tr>);
              })}</tbody>
            </table></div>)}
        </Panel>
      )}

      <Modal abierto={!!orden} onCerrar={() => setReportar(null)} titulo={`Reportar producción · ${orden?.numero ?? ''}`}
        pie={<><button className="btn" onClick={() => setReportar(null)}>Cancelar</button><button className="btn btn-primario" disabled={cant <= 0 || cant > pendiente} onClick={guardarReporte}>Guardar reporte</button></>}>
        <p className="text-sm text-suave">{(orden ? art(orden.articulo_id)?.nombre : "")}: faltan <b className="text-texto">{cantidad(pendiente)}</b> por producir.</p>
        <Campo etiqueta="Cantidad producida en este reporte"><input className="campo" type="number" min={1} max={pendiente} value={cant || ''} onChange={e => setCant(Number(e.target.value))} /></Campo>
        {cant > pendiente && <Aviso tono="rojo">No puede reportar más de lo pendiente ({cantidad(pendiente)}).</Aviso>}
        {cant > 0 && cant === pendiente && <Aviso tono="verde">Con este reporte la orden queda terminada y el producto entra al inventario.</Aviso>}
      </Modal>
    </>
  );
}
