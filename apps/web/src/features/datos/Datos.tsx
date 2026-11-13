// src/features/datos/Datos.tsx — consulta y alta de artículos y clientes
'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { Aviso, Campo, Encabezado, Insignia, Modal, Panel, Pestanas, Vacio, useDialogos } from '@/componentes/ui';
import { IcBuscar, IcDatos, IcMas } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { dinero } from '@/lib/formato';

export function Datos() {
  const { puede, online } = useSesion();
  const { avisar } = useDialogos();
  const articulos = useLiveQuery(() => db.articulos.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes.toArray(), [], []);
  const credito = useLiveQuery(() => db.clientes_credito.toArray(), [], []);
  const [vista, setVista] = useState<'articulos' | 'clientes'>('articulos');
  const [texto, setTexto] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [f, setF] = useState<Record<string, any>>({});
  const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }));
  const t = texto.trim().toLowerCase();

  const arts = articulos.filter(a => !t || `${a.sku} ${a.nombre}`.toLowerCase().includes(t)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const clis = clientes.filter(c => !t || `${c.razon_social} ${c.numero_documento}`.toLowerCase().includes(t)).sort((a, b) => a.razon_social.localeCompare(b.razon_social));
  const permiso = vista === 'articulos' ? 'catalogo.articulo.gestionar' : 'catalogo.cliente.gestionar';

  async function guardar() {
    setGuardando(true); setError(null);
    try {
      if (vista === 'articulos') {
        await api('/catalogo/articulos', { method: 'POST', body: JSON.stringify({
          id: uuidv7(), sku: String(f.sku ?? '').trim(), nombre: String(f.nombre ?? '').trim(), unidadMedida: f.unidad || 'UND',
          precioLista: Number(f.precio ?? 0), porcentajeIva: Number(f.iva ?? 19), esFabricable: !!f.fabricable }) });
      } else {
        await api('/catalogo/clientes', { method: 'POST', body: JSON.stringify({
          id: uuidv7(), tipoDocumento: f.tipo || 'NIT', numeroDocumento: String(f.doc ?? '').trim(), razonSocial: String(f.razon ?? '').trim(),
          correo: f.correo || undefined, telefono: f.telefono || undefined, ciudad: f.ciudad || undefined }) });
      }
      avisar(vista === 'articulos' ? 'Artículo creado' : 'Cliente creado', 'ok');
      setNuevo(false); setF({}); await solicitarSync();
    } catch (e) { setError(mensajeError(e)); }
    finally { setGuardando(false); }
  }

  return (
    <>
      <Encabezado titulo="Datos maestros" detalle="Artículos y clientes que usan todos los módulos. Se consultan sin conexión; crear requiere red."
        acciones={<>
          <Pestanas valor={vista} onCambio={v => { setVista(v); setTexto(''); }} opciones={[{ id: 'articulos', texto: 'Artículos', cuenta: articulos.length }, { id: 'clientes', texto: 'Clientes', cuenta: clientes.length }]} />
          {puede(permiso) && <button className="btn btn-primario" onClick={() => { setNuevo(true); setF({}); setError(null); }}><IcMas width={16} height={16} />Nuevo</button>}
        </>} />

      <Panel cuerpo={false}>
        <div className="relative border-b border-borde p-4">
          <IcBuscar className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-suave" width={15} height={15} />
          <input className="campo !pl-9" placeholder={vista === 'articulos' ? 'Buscar por SKU o nombre' : 'Buscar por razón social o documento'} value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar" />
        </div>
        {(vista === 'articulos' ? arts : clis).length === 0 ? <Vacio icono={<IcDatos />} titulo="Sin resultados" detalle="Ajuste la búsqueda o espere a que termine la sincronización." /> : vista === 'articulos' ? (
          <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[40rem]">
            <thead><tr><th>Artículo</th><th>Unidad</th><th className="num">Precio de lista</th><th className="num">IVA</th><th>Características</th></tr></thead>
            <tbody>{arts.map(a => (<tr key={a.id}><td><p className="font-medium">{a.nombre}</p><p className="text-xs text-suave">{a.sku}</p></td><td className="text-suave">{a.unidad_medida}</td>
              <td className="num">{dinero(a.precio_lista)}</td><td className="num">{Number(a.porcentaje_iva)}%</td>
              <td><div className="flex flex-wrap gap-1">{a.es_fabricable && <Insignia tono="violeta">Fabricable</Insignia>}{a.maneja_inventario === false && <Insignia>Servicio</Insignia>}{a.publicado_web && <Insignia tono="azul">En la tienda</Insignia>}</div></td></tr>))}</tbody>
          </table></div>
        ) : (
          <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[40rem]">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th className="num">Cupo de crédito</th></tr></thead>
            <tbody>{clis.map(c => { const cr = credito.find(x => x.id === c.id); return (
              <tr key={c.id}><td className="font-medium">{c.razon_social}</td><td className="text-suave">{c.tipo_documento} {c.numero_documento}</td>
                <td className="text-suave">{c.correo ?? c.telefono ?? '—'}</td>
                <td className="num">{cr ? <>{dinero(cr.limite_credito)}{cr.bloqueado && <span className="ml-2"><Insignia tono="rojo">Bloqueado</Insignia></span>}</> : '—'}</td></tr>); })}</tbody>
          </table></div>
        )}
      </Panel>

      <Modal abierto={nuevo} onCerrar={() => setNuevo(false)} titulo={vista === 'articulos' ? 'Nuevo artículo' : 'Nuevo cliente'}
        pie={<><button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando || !online || (vista === 'articulos' ? !(f.sku && f.nombre) : !(f.doc && f.razon))} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button></>}>
        {vista === 'articulos' ? (<>
          <div className="grid grid-cols-2 gap-3"><Campo etiqueta="SKU"><input className="campo" value={f.sku ?? ''} onChange={e => set('sku', e.target.value)} /></Campo>
            <Campo etiqueta="Unidad"><input className="campo" placeholder="UND" value={f.unidad ?? ''} onChange={e => set('unidad', e.target.value)} /></Campo></div>
          <Campo etiqueta="Nombre"><input className="campo" value={f.nombre ?? ''} onChange={e => set('nombre', e.target.value)} /></Campo>
          <div className="grid grid-cols-2 gap-3"><Campo etiqueta="Precio de lista"><input className="campo" type="number" min={0} value={f.precio ?? ''} onChange={e => set('precio', e.target.value)} /></Campo>
            <Campo etiqueta="IVA %"><input className="campo" type="number" min={0} max={100} placeholder="19" value={f.iva ?? ''} onChange={e => set('iva', e.target.value)} /></Campo></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.fabricable} onChange={e => set('fabricable', e.target.checked)} />Se fabrica cuando falta stock (R1)</label>
        </>) : (<>
          <div className="grid grid-cols-[7rem_1fr] gap-3"><Campo etiqueta="Tipo"><select className="campo" value={f.tipo ?? 'NIT'} onChange={e => set('tipo', e.target.value)}>
            {['NIT', 'CC', 'CE', 'PAS'].map(x => <option key={x}>{x}</option>)}</select></Campo>
            <Campo etiqueta="Número de documento"><input className="campo" value={f.doc ?? ''} onChange={e => set('doc', e.target.value)} /></Campo></div>
          <Campo etiqueta="Razón social o nombre"><input className="campo" value={f.razon ?? ''} onChange={e => set('razon', e.target.value)} /></Campo>
          <div className="grid grid-cols-2 gap-3"><Campo etiqueta="Correo"><input className="campo" type="email" value={f.correo ?? ''} onChange={e => set('correo', e.target.value)} /></Campo>
            <Campo etiqueta="Teléfono"><input className="campo" value={f.telefono ?? ''} onChange={e => set('telefono', e.target.value)} /></Campo></div>
          <Campo etiqueta="Ciudad"><input className="campo" value={f.ciudad ?? ''} onChange={e => set('ciudad', e.target.value)} /></Campo>
          <p className="text-xs text-suave">El cupo de crédito lo asigna cartera; hasta entonces el cliente compra de contado.</p>
        </>)}
        {!online && <Aviso tono="ambar">Crear registros maestros requiere conexión.</Aviso>}
        {error && <Aviso tono="rojo">{error}</Aviso>}
      </Modal>
    </>
  );
}
