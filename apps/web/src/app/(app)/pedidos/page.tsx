'use client';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { ChipRegla, Encabezado, Pestanas } from '@/componentes/ui';
import { ListaPedidos } from '@/features/pedidos/ListaPedidos';
import { NuevoPedido } from '@/features/pedidos/NuevoPedido';

export default function PaginaPedidos() {
  const [vista, setVista] = useState<'lista' | 'nuevo'>('lista');
  const total = useLiveQuery(() => db.pedidos.count(), [], 0);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('nuevo')) setVista('nuevo'); }, []);
  return (
    <>
      <Encabezado titulo="Pedidos" detalle="Cree pedidos en el mostrador o por teléfono. El sistema reserva stock y abre fabricación si falta."
        reglas={<><ChipRegla r="R2" /><ChipRegla r="R3" /><ChipRegla r="R13" /></>}
        acciones={<Pestanas valor={vista} onCambio={setVista} opciones={[{ id: 'lista', texto: 'Pedidos', cuenta: total }, { id: 'nuevo', texto: 'Nuevo pedido' }]} />} />
      {vista === 'nuevo' ? <NuevoPedido alTerminar={() => setVista('lista')} /> : <ListaPedidos />}
    </>
  );
}
