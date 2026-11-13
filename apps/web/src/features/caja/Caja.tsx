// src/features/caja/Caja.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/offline/db';
import { api, mensajeError } from '@/offline/api';
import { solicitarSync } from '@/offline/motor-sync';
import { cobrarEnLinea, registrarCobroEfectivo } from '@/offline/repos/caja';
import { Aviso, Campo, ChipRegla, Encabezado, Indicador, Insignia, Modal, Panel, Vacio, useDialogos } from '@/componentes/ui';
import { IcCaja, IcCandado, IcDeshacer, IcTarjeta, IcReloj } from '@/componentes/iconos';
import { useSesion } from '@/componentes/Sesion';
import { dinero, fecha, numeroFactura, parecePan } from '@/lib/formato';

const MEDIOS = [['EFECTIVO', 'Efectivo'], ['TARJETA', 'Tarjeta'], ['TRANSFERENCIA', 'Transferencia'], ['CHEQUE', 'Cheque']] as const;
type Medio = typeof MEDIOS[number][0];
const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export function Caja() {
  const { perfil, online, porSincronizar, puede } = useSesion();
  const { avisar, pedirMotivo } = useDialogos();
  const cajas = useLiveQuery(() => db.cajas.toArray(), [], []);
  const sesiones = useLiveQuery(() => db.sesiones_caja.toArray(), [], []);
  const movimientos = useLiveQuery(() => db.movimientos_caja.toArray(), [], []);
  const facturas = useLiveQuery(() => db.facturas.toArray(), [], []);
  const clientes = useLiveQuery(() => db.clientes.toArray(), [], []);

  const mia = sesiones.find(s => s.estado === 'ABIERTA' && s.usuario_id === perfil?.id);
  const movs = useMemo(() => movimientos.filter(m => m.sesion_id === mia?.id).sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en))), [movimientos, mia?.id]);
  const efectivo = Number(mia?.monto_apertura ?? 0) + movs.filter(m => m.medio_pago === 'EFECTIVO').reduce((s, m) => s + (m.sentido === 'ENTRADA' ? 1 : -1) * Number(m.valor), 0);
  const cobros = movs.filter(m => m.sentido === 'ENTRADA').reduce((s, m) => s + Number(m.valor), 0);
  const reversados = new Set(movs.filter(m => m.id_movimiento_relacionado).map(m => m.id_movimiento_relacionado));
  const conSaldo = facturas.filter(f => f.estado !== 'ANULADA' && Number(f.saldo) > 0);
  const cliente = (id: string) => clientes.find(c => c.id === id)?.razon_social ?? '—';

  // Apertura
  const [cajaId, setCajaId] = useState(''); const [apertura, setApertura] = useState(0); const [abriendo, setAbriendo] = useState(false);
  // Cobro
  const [medio, setMedio] = useState<Medio>('EFECTIVO'); const [valor, setValor] = useState(0); const [ref, setRef] = useState('');
  const [facturaId, setFacturaId] = useState(''); const [cobrando, setCobrando] = useState(false); const [errCobro, setErrCobro] = useState<string | null>(null);
  // Arqueo
  const [arqueo, setArqueo] = useState(false); const [conteo, setConteo] = useState<Record<number, number>>({}); const [obs, setObs] = useState(''); const [cerrando, setCerrando] = useState(false);
  const [errCierre, setErrCierre] = useState<string | null>(null);

  useEffect(() => { const f = new URLSearchParams(window.location.search).get('factura'); if (f) setFacturaId(f); }, []);
  useEffect(() => { const f = facturas.find(x => x.id === facturaId); if (f) setValor(Number(f.saldo)); }, [facturaId, facturas]);

  const contado = DENOMINACIONES.reduce((s, d) => s + d * (conteo[d] ?? 0), 0);
  const diferencia = contado - efectivo;
  const pan = medio === 'TARJETA' && parecePan(ref);
  const refInvalida = medio === 'TARJETA' && (ref.trim().length < 6 || pan);
  const requiereLinea = medio !== 'EFECTIVO';

  async function abrir() {
    setAbriendo(true);
    try {
      await api('/caja/sesiones', { method: 'POST', body: JSON.stringify({ id: uuidv7(), cajaId, montoApertura: apertura }) });
      avisar('Sesión de caja abierta', 'ok'); await solicitarSync();
    } catch (e) { avisar(mensajeError(e), 'error'); }
    finally { setAbriendo(false); }
  }

  async function cobrar() {
    if (!mia) return;
    setCobrando(true); setErrCobro(null);
    try {
      const f = facturas.find(x => x.id === facturaId);
      if (medio === 'EFECTIVO') await registrarCobroEfectivo({ sesionId: mia.id, valor, facturaId: f?.id, pedidoId: f?.pedido_id });
      else await cobrarEnLinea({ sesionId: mia.id, medioPago: medio, valor, referencia: ref.trim(), facturaId: f?.id, pedidoId: f?.pedido_id });
      avisar('Cobro registrado', 'ok'); setValor(0); setRef(''); setFacturaId('');
    } catch (e) { setErrCobro(mensajeError(e)); }
    finally { setCobrando(false); }
  }

  async function reversar(id: string) {
    const motivo = await pedirMotivo({ titulo: 'Reversar movimiento', detalle: 'No se edita ni se borra: se crea un movimiento contrario que lo cancela (R9).', confirmar: 'Reversar', peligro: true });
    if (!motivo) return;
    try { await api(`/caja/movimientos/${id}/reversar`, { method: 'POST', body: JSON.stringify({ id: uuidv7(), motivo }) }); avisar('Movimiento reversado', 'ok'); await solicitarSync(); }
    catch (e) { avisar(mensajeError(e), 'error'); }
  }

  async function cerrar() {
    if (!mia) return;
    setCerrando(true); setErrCierre(null);
    try {
      const r = await api<{ esperado: number; diferencia: number }>(`/caja/sesiones/${mia.id}/cerrar`, {
        method: 'POST', body: JSON.stringify({ arqueoId: uuidv7(), efectivoContado: contado, denominaciones: Object.fromEntries(Object.entries(conteo).filter(([, n]) => n > 0)), observacion: obs.trim() || undefined }) });
      avisar(r.diferencia === 0 ? 'Caja cerrada: el arqueo cuadra' : `Caja cerrada con diferencia de ${dinero(r.diferencia)}`, r.diferencia === 0 ? 'ok' : 'info');
      setArqueo(false); setConteo({}); setObs(''); await solicitarSync();
    } catch (e) { setErrCierre(mensajeError(e)); }
    finally { setCerrando(false); }
  }

  const historial = sesiones.filter(s => s.estado === 'CERRADA' && s.usuario_id === perfil?.id).sort((a, b) => String(b.cerrada_en).localeCompare(String(a.cerrada_en))).slice(0, 5);

  return (
    <>
      <Encabezado titulo="Caja" detalle="Abra su turno, registre cobros y cierre con arqueo. Los cobros en efectivo funcionan sin conexión."
        reglas={<><ChipRegla r="R8">un turno abierto</ChipRegla><ChipRegla r="R9">reversos</ChipRegla><ChipRegla r="R10">solo token</ChipRegla></>}
        acciones={mia ? <button className="btn btn-peligro" disabled={!puede('caja.sesion.cerrar')} onClick={() => setArqueo(true)}><IcCandado width={16} height={16} />Cerrar caja</button> : undefined} />

      {!mia ? (
        <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)]">
          <Panel titulo="Abrir turno de caja" detalle="Se necesita conexión para abrir (R8)">
            {!puede('caja.sesion.abrir') ? <Aviso tono="ambar">Su rol no puede abrir caja.</Aviso> : (
              <div className="space-y-3">
                <Campo etiqueta="Caja">
                  <select className="campo" value={cajaId} onChange={e => setCajaId(e.target.value)}>
                    <option value="">Seleccione una caja…</option>
                    {cajas.filter(c => c.activa !== false).map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Efectivo inicial"><input className="campo" type="number" min={0} value={apertura} onChange={e => setApertura(Math.max(0, Number(e.target.value)))} /></Campo>
                <button className="btn btn-primario btn-bloque" disabled={!cajaId || !online || abriendo} onClick={abrir}>{abriendo ? 'Abriendo…' : 'Abrir caja'}</button>
                {!online && <p className="text-xs text-ambar">Sin conexión: no se puede abrir un turno nuevo.</p>}
              </div>)}
          </Panel>
          <Panel titulo="Mis últimos turnos" cuerpo={false}>
            {historial.length === 0 ? <Vacio icono={<IcCaja />} titulo="Sin turnos cerrados" detalle="Cuando cierre su primer turno verá aquí el resultado del arqueo." /> : (
              <div className="overflow-x-auto px-2 pb-2"><table className="tabla">
                <thead><tr><th>Cierre</th><th className="num">Esperado</th><th className="num">Contado</th><th className="num">Diferencia</th></tr></thead>
                <tbody>{historial.map(s => (<tr key={s.id}><td>{fecha(s.cerrada_en, true)}</td><td className="num">{dinero(s.monto_cierre_sistema)}</td><td className="num">{dinero(s.monto_cierre_declarado)}</td>
                  <td className={`num ${Number(s.diferencia) === 0 ? 'text-verde' : 'text-ambar'}`}>{dinero(s.diferencia)}</td></tr>))}</tbody>
              </table></div>)}
          </Panel>
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador titulo="Turno abierto desde" valor={new Date(mia.abierta_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} tono="azul" icono={<IcReloj width={15} height={15} />} nota={`${fecha(mia.abierta_en)} · apertura ${dinero(mia.monto_apertura)}`} />
            <Indicador titulo="Efectivo esperado" valor={dinero(efectivo)} tono="verde" icono={<IcCaja width={15} height={15} />} nota="Apertura + entradas − salidas en efectivo" />
            <Indicador titulo="Cobros del turno" valor={dinero(cobros)} tono="violeta" icono={<IcTarjeta width={15} height={15} />} nota="Todos los medios de pago" />
            <Indicador titulo="Movimientos" valor={movs.length} tono="ambar" nota={porSincronizar ? `${porSincronizar} por sincronizar` : 'Todo sincronizado'} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
            <Panel titulo="Registrar cobro">
              <div className="space-y-3">
                <Campo etiqueta="Factura a cobrar (opcional)">
                  <select className="campo" value={facturaId} onChange={e => setFacturaId(e.target.value)}>
                    <option value="">Sin factura asociada</option>
                    {conSaldo.map(f => <option key={f.id} value={f.id}>{numeroFactura(f)} · {cliente(f.cliente_id)} · saldo {dinero(f.saldo)}</option>)}
                  </select>
                </Campo>
                <div>
                  <span className="etiqueta">Medio de pago</span>
                  <div className="grid grid-cols-2 gap-2">{MEDIOS.map(([v, t]) => (
                    <button key={v} aria-pressed={medio === v} onClick={() => setMedio(v)} className={`btn ${medio === v ? '!border-azul/60 !bg-azul/15' : ''}`}>{t}</button>))}</div>
                </div>
                <Campo etiqueta="Valor"><input className="campo" type="number" min={0} value={valor || ''} onChange={e => setValor(Math.max(0, Number(e.target.value)))} /></Campo>
                {medio !== 'EFECTIVO' && (
                  <Campo etiqueta={medio === 'TARJETA' ? 'Token o código de autorización' : 'Referencia (opcional)'}
                    ayuda={medio === 'TARJETA' ? 'Lo entrega la pasarela de pagos. Nunca escriba el número de la tarjeta.' : undefined}>
                    <input className="campo" value={ref} onChange={e => setRef(e.target.value)} autoComplete="off" inputMode="text" />
                  </Campo>)}
                {pan && <Aviso tono="rojo">Eso parece un <b>número de tarjeta</b>. Por seguridad (R10) no se acepta: use el token de la pasarela.</Aviso>}
                {errCobro && <Aviso tono="rojo">{errCobro}</Aviso>}
                <button className="btn btn-primario btn-bloque" disabled={!valor || refInvalida || cobrando || (requiereLinea && !online) || !puede('caja.cobro.registrar')} onClick={cobrar}>
                  {cobrando ? 'Registrando…' : `Cobrar ${valor ? dinero(valor) : ''}`}
                </button>
                {requiereLinea && !online && <p className="text-xs text-ambar">Este medio de pago necesita conexión. El efectivo sí se puede registrar sin red.</p>}
              </div>
            </Panel>

            <Panel titulo="Movimientos del turno" detalle="Solo se agregan; los errores se corrigen con un reverso" cuerpo={false}>
              {movs.length === 0 ? <Vacio icono={<IcCaja />} titulo="Todavía no hay movimientos" detalle="Registre el primer cobro con el formulario." /> : (
                <div className="overflow-x-auto px-2 pb-2"><table className="tabla min-w-[36rem]">
                  <thead><tr><th>Hora</th><th>Tipo</th><th>Medio</th><th>Referencia</th><th className="num">Valor</th><th /></tr></thead>
                  <tbody>{movs.map(m => (
                    <tr key={m.id}>
                      <td className="nowrap text-suave">{fecha(m.creado_en, true)}{m._pendiente && <span className="ml-1 text-ambar">· pendiente</span>}</td>
                      <td><Insignia tono={m.tipo === 'REVERSO' ? 'rojo' : m.sentido === 'ENTRADA' ? 'verde' : 'ambar'}>{m.tipo.toLowerCase()}</Insignia></td>
                      <td>{m.medio_pago?.toLowerCase()}</td>
                      <td className="max-w-40 truncate text-suave">{m.referencia ? `•••• ${String(m.referencia).slice(-4)}` : '—'}</td>
                      <td className={`num font-medium ${m.sentido === 'SALIDA' ? 'text-rojo' : ''}`}>{m.sentido === 'SALIDA' ? '−' : ''}{dinero(m.valor)}</td>
                      <td className="text-right">{m.tipo !== 'REVERSO' && !m._pendiente && !reversados.has(m.id) && puede('caja.movimiento.reversar') &&
                        <button className="btn btn-sm" disabled={!online} onClick={() => reversar(m.id)} title={online ? '' : 'Requiere conexión'}><IcDeshacer width={13} height={13} />Reversar</button>}
                        {reversados.has(m.id) && <span className="text-xs text-suave">Reversado</span>}</td>
                    </tr>))}</tbody>
                </table></div>)}
            </Panel>
          </div>
        </>
      )}

      <Modal abierto={arqueo} onCerrar={() => setArqueo(false)} titulo="Cierre de caja con arqueo" ancho="max-w-xl"
        pie={<><button className="btn" onClick={() => setArqueo(false)}>Volver</button>
          <button className="btn btn-peligro-solido" disabled={cerrando || !online || porSincronizar > 0 || contado <= 0 && efectivo > 0} onClick={cerrar}>{cerrando ? 'Cerrando…' : 'Cerrar caja'}</button></>}>
        <p className="text-sm text-suave">Cuente el efectivo del cajón e ingrese cuántos billetes y monedas hay de cada denominación.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{DENOMINACIONES.map(d => (
          <label key={d} className="flex items-center justify-between gap-2 text-sm"><span className="tabular-nums text-suave">{dinero(d)}</span>
            <input className="campo !w-16 text-right" type="number" min={0} value={conteo[d] ?? ''} aria-label={`Cantidad de ${d}`} onChange={e => setConteo({ ...conteo, [d]: Math.max(0, Math.floor(Number(e.target.value))) })} /></label>))}</div>
        <dl className="grid grid-cols-3 gap-3 rounded-lg bg-panel2 p-3 text-sm">
          <div><dt className="text-xs text-suave">Esperado</dt><dd className="font-semibold tabular-nums">{dinero(efectivo)}</dd></div>
          <div><dt className="text-xs text-suave">Contado</dt><dd className="font-semibold tabular-nums">{dinero(contado)}</dd></div>
          <div><dt className="text-xs text-suave">Diferencia</dt><dd className={`font-semibold tabular-nums ${diferencia === 0 ? 'text-verde' : 'text-ambar'}`}>{dinero(diferencia)}</dd></div>
        </dl>
        <Campo etiqueta="Observación (opcional)"><textarea className="campo min-h-[64px]" value={obs} onChange={e => setObs(e.target.value)} /></Campo>
        {porSincronizar > 0 && <Aviso tono="ambar">Hay {porSincronizar} operaciones sin enviar. Sincronice antes de cerrar para que el arqueo use todos los cobros.</Aviso>}
        {!online && <Aviso tono="ambar">Cerrar la caja requiere conexión.</Aviso>}
        {errCierre && <Aviso tono="rojo">{errCierre}</Aviso>}
      </Modal>
    </>
  );
}
