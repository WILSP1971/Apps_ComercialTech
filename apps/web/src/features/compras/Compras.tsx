// src/features/compras/Compras.tsx
'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { guardarBorradorOrden, guardarProveedor, nuevoId, registrarRecepcion } from '@/offline/repos/compras';
import { Aviso, Campo, ChipRegla, Encabezado, Indicador, Insignia, Modal, Panel, Pestanas, Vacio, useDialogos } from '@/componentes/ui';
import { IcCerrar, IcCompras, IcMas } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { cantidad, dinero, fecha } from '@/lib/formato';
import { ESTADO_ORDEN_COMPRA } from '@/lib/estados';

type Vista = 'ordenes' | 'nueva' | 'proveedores';
interface LineaN { id: string; articuloId: string; cantidad: number; costo: number }

export function Compras() {
  const { puede, online } = useSesion();
  const { avisar, pedirMotivo } = useDialogos();
  const proveedores = useLiveQuery(() => db.proveedores.orderBy('razon_social').toArray(), [], []);
  const ordenes = useLiveQuery(() => db.ordenes_compra.toArray(), [], []);
  const lineas = useLiveQuery(() => db.orden_compra_lineas.toArray(), [], []);
  const articulos = useLiveQuery(() => db.articulos.toArray(), [], []);
  const bodegas = useLiveQuery(() => db.bodegas.toArray(), [], []);

  const [vista, setVista] = useState<Vista>('ordenes');
  const [provId, setProvId] = useState(''); const [bodegaId, setBodegaId] = useState(''); const [esperada, setEsperada] = useState('');
  const [nuevas, setNuevas] = useState<LineaN[]>([]); const [artId, setArtId] = useState('');
  const [nit, setNit] = useState(''); const [razon, setRazon] = useState(''); const [plazo, setPlazo] = useState(30);
  const [recibirDe, setRecibirDe] = useState<string | null>(null); const [recibir, setRecibir] = useState<Record<string, number>>({});

  const prov = (id: string) => proveedores.find(p => p.id === id)?.razon_social ?? '—';
  const art = (id: string) => articulos.find(a => a.id === id);
  const bodega = bodegaId || bodegas[0]?.id || '';
  const lineasDe = (id: string) => lineas.filter(l => l.orden_id === id && !l.eliminado_en);
  const lista = [...ordenes].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));
  const abiertas = ordenes.filter(o => !['CERRADA', 'ANULADA', 'RECIBIDA'].includes(o.estado));
  const porRecibir = ordenes.filter(o => ['ENVIADA', 'RECIBIDA_PARCIAL'].includes(o.estado));
  const comprometido = abiertas.reduce((s, o) => s + Number(o.total), 0);
  const totalNueva = nuevas.reduce((s, l) => s + l.cantidad * l.costo, 0);
  const ordenRecibir = ordenes.find(o => o.id === recibirDe);

  /** Acciones que exige el servidor en línea (segregación de funciones y R11). */
  async function accion(id: string, ruta: string, ok: string, cuerpo: object = {}) {
    try { await api(`/compras/ordenes/${id}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }); avisar(ok, 'ok'); await solicitarSync(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
  }
  async function anular(id: string) {
    const motivo = await pedirMotivo({ titulo: 'Anular orden de compra', confirmar: 'Anular orden', peligro: true });
    if (motivo) await accion(id, 'anular', 'Orden anulada', { motivo });
  }
  async function guardarOrden() {
    await guardarBorradorOrden({ id: nuevoId(), proveedorId: provId, bodegaId: bodega, fechaEsperada: esperada || undefined,
      lineas: nuevas.map(l => ({ id: l.id, articuloId: l.articuloId, cantidad: l.cantidad, costoUnitario: l.costo })) });
    avisar('Borrador guardado', 'ok'); setNuevas([]); setProvId(''); setEsperada(''); setVista('ordenes');
  }
  async function confirmarRecepcion() {
    if (!ordenRecibir) return;
    const ls = lineasDe(ordenRecibir.id).filter(l => (recibir[l.id] ?? 0) > 0).map(l => ({ ordenLineaId: l.id, cantidad: recibir[l.id] }));
    if (ls.length === 0) return;
    await registrarRecepcion({ ordenId: ordenRecibir.id, lineas: ls });
    avisar('Recepción registrada', 'ok'); setRecibirDe(null); setRecibir({});
  }

  return (
    <>
      <Encabezado titulo="Compras" detalle="Órdenes de compra a proveedores, aprobación y recepción en bodega."
        reglas={<><ChipRegla r="R11">cierra con recepción</ChipRegla><ChipRegla r="R5">kardex inmutable</ChipRegla></>}
        acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[{ id: 'ordenes', texto: 'Órdenes', cuenta: ordenes.length }, { id: 'nueva', texto: 'Nueva orden' }, { id: 'proveedores', texto: 'Proveedores', cuenta: proveedores.length }]} />} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Órdenes abiertas" valor={abiertas.length} tono="azul" icono={<IcCompras width={15} height={15} />} />
        <Indicador titulo="Por recibir" valor={porRecibir.length} tono="violeta" nota="Enviadas o con recepción parcial" />
        <Indicador titulo="Valor comprometido" valor={dinero(comprometido)} tono="ambar" nota="Órdenes sin cerrar" />
      </div>

      {vista === 'ordenes' && (
        <Panel cuerpo={false}>
          {lista.length === 0 ? <Vacio icono={<IcCompras />} titulo="Aún no hay órdenes de compra" detalle="Cree la primera desde “Nueva orden”." accion={<button className="btn btn-primario btn-sm" onClick={() => setVista('nueva')}>Nueva orden</button>} /> : (
            <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[46rem]">
              <thead><tr><th>Orden</th><th>Proveedor</th><th>Recepción</th><th>Estado</th><th className="num">Total</th><th /></tr></thead>
              <tbody>{lista.map(o => {
                const e = ESTADO_ORDEN_COMPRA[o.estado] ?? { texto: o.estado, tono: 'gris' as const };
                const ls = lineasDe(o.id);
                const pedido = ls.reduce((s, l) => s + Number(l.cantidad), 0), recibido = ls.reduce((s, l) => s + Number(l.cantidad_recibida), 0);
                return (<tr key={o.id}>
                  <td><p className="font-medium">{o.numero ?? 'Borrador'}</p><p className="text-xs text-suave">{fecha(o.creado_en)}{o._pendiente ? ' · por sincronizar' : ''}</p></td>
                  <td>{prov(o.proveedor_id)}</td>
                  <td className="text-suave">{cantidad(recibido)} de {cantidad(pedido)}</td>
                  <td><Insignia tono={e.tono} punto>{e.texto}</Insignia></td>
                  <td className="num font-medium">{dinero(o.total)}</td>
                  <td><div className="flex flex-wrap justify-end gap-1.5">
                    {o.estado === 'BORRADOR' && !o._pendiente && <button className="btn btn-sm" disabled={!online} onClick={() => accion(o.id, 'enviar-aprobacion', 'Enviada a aprobación')}>Pedir aprobación</button>}
                    {o.estado === 'PENDIENTE_APROBACION' && puede('compras.orden.aprobar') && <button className="btn btn-sm btn-exito" disabled={!online} onClick={() => accion(o.id, 'aprobar', 'Orden aprobada')}>Aprobar</button>}
                    {o.estado === 'APROBADA' && <button className="btn btn-sm btn-primario" disabled={!online} onClick={() => accion(o.id, 'enviar', 'Marcada como enviada')}>Marcar enviada</button>}
                    {['ENVIADA', 'RECIBIDA_PARCIAL'].includes(o.estado) && <button className="btn btn-sm btn-primario" onClick={() => { setRecibirDe(o.id); setRecibir({}); }}>Recibir</button>}
                    {o.estado === 'RECIBIDA' && <button className="btn btn-sm" disabled={!online} onClick={() => accion(o.id, 'cerrar', 'Orden cerrada')}>Cerrar</button>}
                    {['BORRADOR', 'PENDIENTE_APROBACION', 'APROBADA', 'ENVIADA'].includes(o.estado) && !o._pendiente && <button className="btn btn-sm btn-peligro" disabled={!online} onClick={() => anular(o.id)}>Anular</button>}
                  </div></td>
                </tr>);
              })}</tbody>
            </table></div>)}
        </Panel>
      )}

      {vista === 'nueva' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel titulo="Líneas de la orden" cuerpo={false}
            acciones={<select className="campo !w-56" value={artId} aria-label="Agregar artículo" onChange={e => {
              const id = e.target.value; if (!id) return;
              setNuevas(ls => ls.some(l => l.articuloId === id) ? ls : [...ls, { id: nuevoId(), articuloId: id, cantidad: 1, costo: 0 }]); setArtId('');
            }}><option value="">+ Agregar artículo…</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>}>
            {nuevas.length === 0 ? <Vacio icono={<IcMas />} titulo="Agregue artículos a la orden" detalle="Use el selector de arriba a la derecha." /> : (
              <div className="overflow-x-auto px-2 pb-2"><table className="tabla">
                <thead><tr><th>Artículo</th><th className="num">Cantidad</th><th className="num">Costo unitario</th><th className="num">Subtotal</th><th /></tr></thead>
                <tbody>{nuevas.map(l => (<tr key={l.id}>
                  <td className="font-medium">{art(l.articuloId)?.nombre}</td>
                  <td className="num"><input className="campo !w-24 text-right" type="number" min={1} value={l.cantidad} aria-label="Cantidad" onChange={e => setNuevas(ls => ls.map(x => x.id === l.id ? { ...x, cantidad: Math.max(0, Number(e.target.value)) } : x))} /></td>
                  <td className="num"><input className="campo !w-32 text-right" type="number" min={0} value={l.costo} aria-label="Costo unitario" onChange={e => setNuevas(ls => ls.map(x => x.id === l.id ? { ...x, costo: Math.max(0, Number(e.target.value)) } : x))} /></td>
                  <td className="num">{dinero(l.cantidad * l.costo)}</td>
                  <td><button className="btn btn-sm !border-transparent !bg-transparent" aria-label="Quitar" onClick={() => setNuevas(ls => ls.filter(x => x.id !== l.id))}><IcCerrar width={14} height={14} /></button></td>
                </tr>))}</tbody>
              </table></div>)}
          </Panel>
          <Panel titulo="Datos de la orden">
            <div className="space-y-3">
              <Campo etiqueta="Proveedor"><select className="campo" value={provId} onChange={e => setProvId(e.target.value)}>
                <option value="">Seleccione…</option>{proveedores.filter(p => p.activo !== false).map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}</select></Campo>
              <Campo etiqueta="Bodega de recepción"><select className="campo" value={bodega} onChange={e => setBodegaId(e.target.value)}>
                {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre ?? b.codigo}</option>)}</select></Campo>
              <Campo etiqueta="Fecha esperada"><input className="campo" type="date" value={esperada} onChange={e => setEsperada(e.target.value)} /></Campo>
              <div className="flex justify-between border-t border-borde pt-3 text-base font-semibold"><span>Total</span><span className="tabular-nums">{dinero(totalNueva)}</span></div>
              <button className="btn btn-primario btn-bloque" disabled={!provId || !bodega || nuevas.length === 0 || nuevas.some(l => l.cantidad <= 0)} onClick={guardarOrden}>Guardar borrador</button>
              <p className="text-xs text-suave">El borrador se guarda aquí aunque no haya red. Pedir aprobación y aprobar requieren conexión.</p>
            </div>
          </Panel>
        </div>
      )}

      {vista === 'proveedores' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Panel cuerpo={false}>
            {proveedores.length === 0 ? <Vacio icono={<IcCompras />} titulo="Sin proveedores" detalle="Registre el primero con el formulario." /> : (
              <div className="overflow-x-auto px-2 pb-2"><table className="tabla">
                <thead><tr><th>Proveedor</th><th>NIT</th><th className="num">Plazo</th><th>Estado</th></tr></thead>
                <tbody>{proveedores.map(p => (<tr key={p.id}><td className="font-medium">{p.razon_social}</td><td className="text-suave">{p.nit}</td>
                  <td className="num">{p.plazo_dias} días</td><td>{p.activo === false ? <Insignia>Inactivo</Insignia> : <Insignia tono="verde" punto>Activo</Insignia>}</td></tr>))}</tbody>
              </table></div>)}
          </Panel>
          <Panel titulo="Nuevo proveedor">
            <div className="space-y-3">
              <Campo etiqueta="NIT"><input className="campo" value={nit} onChange={e => setNit(e.target.value)} /></Campo>
              <Campo etiqueta="Razón social"><input className="campo" value={razon} onChange={e => setRazon(e.target.value)} /></Campo>
              <Campo etiqueta="Plazo de pago (días)"><input className="campo" type="number" min={0} value={plazo} onChange={e => setPlazo(Math.max(0, Number(e.target.value)))} /></Campo>
              <button className="btn btn-primario btn-bloque" disabled={nit.trim().length < 5 || razon.trim().length < 2 || !puede('compras.proveedor.gestionar')}
                onClick={async () => { await guardarProveedor({ id: nuevoId(), nit: nit.trim(), razonSocial: razon.trim(), plazoDias: plazo }); setNit(''); setRazon(''); avisar('Proveedor guardado', 'ok'); }}>Guardar proveedor</button>
            </div>
          </Panel>
        </div>
      )}

      <Modal abierto={!!ordenRecibir} onCerrar={() => setRecibirDe(null)} titulo={`Recibir mercancía · ${ordenRecibir?.numero ?? ''}`} ancho="max-w-xl"
        pie={<><button className="btn" onClick={() => setRecibirDe(null)}>Cancelar</button>
          <button className="btn btn-primario" disabled={!ordenRecibir || !lineasDe(ordenRecibir.id).some(l => (recibir[l.id] ?? 0) > 0) || lineasDe(ordenRecibir.id).some(l => (recibir[l.id] ?? 0) > Number(l.cantidad) - Number(l.cantidad_recibida))} onClick={confirmarRecepcion}>Registrar recepción</button></>}>
        <p className="text-sm text-suave">Escriba cuánto llegó de cada artículo. No puede recibir más de lo pendiente.</p>
        <ul className="divide-y divide-borde">{ordenRecibir && lineasDe(ordenRecibir.id).map(l => {
          const pend = Number(l.cantidad) - Number(l.cantidad_recibida);
          return (<li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div><p className="font-medium">{art(l.articulo_id)?.nombre}</p><p className="text-xs text-suave">Pendiente {cantidad(pend)} de {cantidad(l.cantidad)}</p></div>
            <input className="campo !w-24 text-right" type="number" min={0} max={pend} disabled={pend <= 0} value={recibir[l.id] ?? ''} aria-label={`Recibido de ${art(l.articulo_id)?.nombre}`}
              onChange={e => setRecibir({ ...recibir, [l.id]: Math.max(0, Number(e.target.value)) })} />
          </li>);
        })}</ul>
        {ordenRecibir && lineasDe(ordenRecibir.id).some(l => (recibir[l.id] ?? 0) > Number(l.cantidad) - Number(l.cantidad_recibida)) && <Aviso tono="rojo">Una de las cantidades supera lo pendiente.</Aviso>}
      </Modal>
    </>
  );
}
