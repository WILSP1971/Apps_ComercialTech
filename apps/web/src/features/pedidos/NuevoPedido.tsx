// src/features/pedidos/NuevoPedido.tsx — constructor de pedido (funciona sin conexión)
'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { guardarBorrador, confirmarPedido, nuevoId, type LineaBorrador } from '@/offline/repos/pedidos';
import { Aviso, Barra, Campo, ChipRegla, Insignia, Panel, Vacio, useDialogos } from '@/componentes/ui';
import { IcCheck, IcFabrica, IcMas, IcCerrar, IcPedidos } from '@/componentes/iconos';
import { cantidad as fmtCant, dinero, totalesLineas } from '@/lib/formato';

interface Linea { id: string; articuloId: string; cantidad: number; descuentoPct: number }

export function NuevoPedido({ alTerminar }: { alTerminar: () => void }) {
  const { avisar } = useDialogos();
  const clientes = useLiveQuery(() => db.clientes.filter(c => c.activo !== false).toArray(), [], []);
  const credito = useLiveQuery(() => db.clientes_credito.toArray(), [], []);
  const articulos = useLiveQuery(() => db.articulos.filter(a => a.activo !== false).toArray(), [], []);
  const bodegas = useLiveQuery(() => db.bodegas.toArray(), [], []);
  const existencias = useLiveQuery(() => db.existencias.toArray(), [], []);

  const [clienteId, setClienteId] = useState('');
  const [bodegaId, setBodegaId] = useState('');
  const [canal, setCanal] = useState<'MOSTRADOR' | 'TELEFONO'>('MOSTRADOR');
  const [condicion, setCondicion] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const bodega = bodegaId || bodegas[0]?.id || '';
  const art = (id: string) => articulos.find(a => a.id === id);
  const disponible = (articuloId: string) => {
    const e = existencias.find(x => x.articulo_id === articuloId && x.bodega_id === bodega);
    return e ? Number(e.cantidad_fisica) - Number(e.cantidad_reservada) : 0;
  };

  // R1/R2: cuánto se reserva y cuánto va a fabricación por línea
  const detalle = lineas.map(l => {
    const a = art(l.articuloId);
    const disp = a?.maneja_inventario === false ? Infinity : Math.max(0, disponible(l.articuloId));
    const reservar = Math.min(l.cantidad, disp);
    const falta = l.cantidad - reservar;
    return { l, a, disp, reservar, falta, fabricar: a?.es_fabricable ? falta : 0, sinCubrir: a?.es_fabricable ? 0 : falta };
  });
  const totales = totalesLineas(detalle.map(d => ({
    cantidad: d.l.cantidad, precioUnitario: Number(d.a?.precio_lista ?? 0), descuentoPct: d.l.descuentoPct, ivaPct: Number(d.a?.porcentaje_iva ?? 0),
  })));

  const cred = credito.find(c => c.id === clienteId);
  const limite = Number(cred?.limite_credito ?? 0), usado = Number(cred?.credito_usado ?? 0);
  const libre = limite - usado;
  const excede = condicion === 'CREDITO' && totales.total > libre;

  const resultados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return [];
    return articulos.filter(a => a.nombre.toLowerCase().includes(t) || a.sku.toLowerCase().includes(t)).slice(0, 6);
  }, [busca, articulos]);

  const agregar = (articuloId: string) => {
    setLineas(ls => ls.some(l => l.articuloId === articuloId)
      ? ls.map(l => l.articuloId === articuloId ? { ...l, cantidad: l.cantidad + 1 } : l)
      : [...ls, { id: nuevoId(), articuloId, cantidad: 1, descuentoPct: 0 }]);
    setBusca('');
  };
  const cambiar = (id: string, parche: Partial<Linea>) => setLineas(ls => ls.map(l => l.id === id ? { ...l, ...parche } : l));

  const listo = !!clienteId && !!bodega && lineas.length > 0 && lineas.every(l => l.cantidad > 0) && !cred?.bloqueado;

  async function guardar(confirmar: boolean) {
    if (!listo) return;
    setOcupado(true);
    try {
      const id = nuevoId();
      const ls: LineaBorrador[] = detalle.map(d => ({
        id: d.l.id, articuloId: d.l.articuloId, descripcion: d.a?.nombre ?? '', cantidad: d.l.cantidad,
        precioUnitario: Number(d.a?.precio_lista ?? 0), descuentoPct: d.l.descuentoPct, ivaPct: Number(d.a?.porcentaje_iva ?? 0),
      }));
      await guardarBorrador({ id, clienteId, bodegaId: bodega, canal, condicionPago: condicion, lineas: ls });
      if (confirmar) await confirmarPedido(id);
      avisar(confirmar ? 'Pedido enviado a confirmar. Se sincroniza apenas haya conexión.' : 'Borrador guardado en este dispositivo.', 'ok');
      setLineas([]); setClienteId('');
      alTerminar();
    } finally { setOcupado(false); }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <Panel titulo="Datos del pedido">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Cliente">
              <select className="campo" value={clienteId} onChange={e => setClienteId(e.target.value)}>
                <option value="">Seleccione un cliente…</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social} · {c.numero_documento}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Bodega de despacho">
              <select className="campo" value={bodega} onChange={e => setBodegaId(e.target.value)}>
                {bodegas.length === 0 && <option value="">Sin bodegas sincronizadas</option>}
                {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre ?? b.codigo}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Canal">
              <select className="campo" value={canal} onChange={e => setCanal(e.target.value as any)}>
                <option value="MOSTRADOR">Mostrador</option><option value="TELEFONO">Teléfono</option>
              </select>
            </Campo>
            <Campo etiqueta="Condición de pago">
              <select className="campo" value={condicion} onChange={e => setCondicion(e.target.value as any)}>
                <option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option>
              </select>
            </Campo>
          </div>
          {cred?.bloqueado && <div className="mt-3"><Aviso tono="rojo">Este cliente está <b>bloqueado</b> por el área de cartera. No se pueden crear pedidos hasta que se libere.</Aviso></div>}
        </Panel>

        <Panel titulo="Líneas del pedido" detalle="El stock y la fabricación automática se calculan con la bodega elegida"
          acciones={<><ChipRegla r="R1" /><ChipRegla r="R2" /></>} cuerpo={false}>
          <div className="relative border-b border-borde p-4">
            <input className="campo" placeholder="Buscar artículo por nombre o SKU para agregarlo…" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar artículo" />
            {resultados.length > 0 && (
              <ul className="tarjeta absolute inset-x-4 top-[calc(100%-6px)] z-10 max-h-64 overflow-y-auto bg-panel2 shadow-2xl shadow-black/50">
                {resultados.map(a => (
                  <li key={a.id}>
                    <button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-borde/50" onClick={() => agregar(a.id)}>
                      <span><b className="font-medium">{a.nombre}</b> <span className="text-suave">{a.sku}</span></span>
                      <span className="flex items-center gap-2 tabular-nums text-suave">{dinero(a.precio_lista)}<IcMas width={14} height={14} /></span>
                    </button>
                  </li>))}
              </ul>
            )}
          </div>
          {detalle.length === 0 ? <Vacio icono={<IcPedidos />} titulo="Agregue el primer artículo" detalle="Escriba arriba para buscarlo. Verá al instante cuánto hay disponible." /> : (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="tabla min-w-[54rem]">
                <thead><tr><th>Artículo</th><th className="num">Cant.</th><th className="num">Precio</th><th className="num">Desc. %</th><th>Abastecimiento</th><th className="num">Total</th><th /></tr></thead>
                <tbody>{detalle.map(({ l, a, disp, reservar, fabricar, sinCubrir }) => {
                  const t = totalesLineas([{ cantidad: l.cantidad, precioUnitario: Number(a?.precio_lista ?? 0), descuentoPct: l.descuentoPct, ivaPct: Number(a?.porcentaje_iva ?? 0) }]);
                  return (
                    <tr key={l.id}>
                      <td className="min-w-[14rem]"><p className="font-medium">{a?.nombre ?? '—'}</p><p className="text-xs text-suave">{a?.sku} · disponible {disp === Infinity ? 'n/a' : fmtCant(disp)}</p></td>
                      <td className="num"><input className="campo !w-20 text-right" type="number" min={1} value={l.cantidad} aria-label="Cantidad" onChange={e => cambiar(l.id, { cantidad: Math.max(0, Number(e.target.value)) })} /></td>
                      <td className="num">{dinero(a?.precio_lista)}</td>
                      <td className="num"><input className="campo !w-16 text-right" type="number" min={0} max={100} value={l.descuentoPct} aria-label="Descuento" onChange={e => cambiar(l.id, { descuentoPct: Math.min(100, Math.max(0, Number(e.target.value))) })} /></td>
                      <td className="min-w-[10rem]">
                        <div className="flex flex-col items-start gap-1">
                          {reservar > 0 && <Insignia tono="verde" punto>Reserva {fmtCant(reservar)}</Insignia>}
                          {fabricar > 0 && <Insignia tono="violeta"><IcFabrica width={12} height={12} />OF automática · {fmtCant(fabricar)}</Insignia>}
                          {sinCubrir > 0 && <Insignia tono="ambar">Sin stock para {fmtCant(sinCubrir)}</Insignia>}
                        </div>
                      </td>
                      <td className="num font-medium">{dinero(t.total)}</td>
                      <td><button className="btn btn-sm !border-transparent !bg-transparent" aria-label="Quitar línea" onClick={() => setLineas(ls => ls.filter(x => x.id !== l.id))}><IcCerrar width={14} height={14} /></button></td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <aside className="space-y-4">
        <Panel titulo="Crédito del cliente" acciones={<ChipRegla r="R13" />}>
          {!cred ? <p className="text-sm text-suave">Elija un cliente para ver su cupo.</p> : (
            <div className="space-y-3">
              <div className="flex items-end justify-between"><span className="text-xs text-suave">Cupo disponible</span><span className="text-xl font-semibold tabular-nums">{dinero(libre)}</span></div>
              <Barra valor={usado + (condicion === 'CREDITO' ? totales.total : 0)} max={limite || 1} tono={excede ? 'rojo' : usado / (limite || 1) > 0.8 ? 'ambar' : 'verde'} />
              <p className="text-xs text-suave">Usado {dinero(usado)} de {dinero(limite)}</p>
              {excede && <Aviso tono="ambar">Este pedido supera el cupo por <b>{dinero(totales.total - libre)}</b>. Quedará <b>pendiente de aprobación</b> del supervisor.</Aviso>}
              {condicion === 'CREDITO' && !excede && totales.total > 0 && <Aviso tono="verde">Dentro del cupo: no necesita aprobación.</Aviso>}
            </div>
          )}
        </Panel>

        <Panel titulo="Resumen">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-suave">Subtotal</dt><dd className="tabular-nums">{dinero(totales.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-suave">IVA</dt><dd className="tabular-nums">{dinero(totales.impuestos)}</dd></div>
            <div className="flex justify-between border-t border-borde pt-3 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{dinero(totales.total)}</dd></div>
          </dl>
          <div className="mt-4 grid gap-2">
            <button className="btn btn-primario btn-bloque" disabled={!listo || ocupado} onClick={() => guardar(true)}><IcCheck width={16} height={16} />Confirmar pedido</button>
            <button className="btn btn-bloque" disabled={!listo || ocupado} onClick={() => guardar(false)}>Guardar borrador</button>
          </div>
          <p className="mt-3 text-xs text-suave">Puede trabajar sin conexión: el pedido se envía solo cuando vuelva la red y el servidor reserva el stock (R3).</p>
        </Panel>
      </aside>
    </div>
  );
}
