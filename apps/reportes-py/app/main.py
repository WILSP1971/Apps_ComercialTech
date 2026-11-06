# app/main.py
import io
import os
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .seguridad import usuario_actual

pool = AsyncConnectionPool(os.environ["DATABASE_URL_RO"], open=False, kwargs={"row_factory": dict_row})

@asynccontextmanager
async def ciclo_vida(_: FastAPI):
    await pool.open()
    yield
    await pool.close()

app = FastAPI(title="Reportes Sierra Innova", lifespan=ciclo_vida, root_path="/reportes")

async def empresa_del_usuario(usuario_id: str = Depends(usuario_actual),
                              x_empresa_id: str | None = Header(default=None)) -> str:
    async with pool.connection() as con:
        cur = await con.execute(
            """SELECT ue.empresa_id::text AS empresa_id
                 FROM seguridad.usuario_empresa ue
                 JOIN seguridad.rol_permiso rp ON rp.rol_id = ue.rol_id
                 JOIN seguridad.permiso p ON p.id = rp.permiso_id
                WHERE ue.usuario_id = %s AND ue.activo AND p.codigo = 'reportes.ver'
                  AND (%s::uuid IS NULL OR ue.empresa_id = %s::uuid)
                LIMIT 1""", (usuario_id, x_empresa_id, x_empresa_id))
        fila = await cur.fetchone()
    if not fila:
        raise HTTPException(status_code=403, detail="Sin permiso para ver reportes")
    return fila["empresa_id"]

SQL_VENTAS_VENDEDOR = """
SELECT p.vendedor_id::text AS vendedor, date_trunc('month', p.creado_en)::date AS mes,
       count(*) AS pedidos, sum(p.total) AS total
  FROM pedidos.pedido p
 WHERE p.empresa_id = %s AND p.estado IN ('CONFIRMADO','DESPACHADO')
   AND p.creado_en >= %s AND p.creado_en < %s AND p.eliminado_en IS NULL
 GROUP BY 1, 2 ORDER BY 2, 4 DESC
"""

@app.get("/ventas-por-vendedor")
async def ventas_por_vendedor(desde: str = Query(...), hasta: str = Query(...),
                              formato: str = "json", empresa_id: str = Depends(empresa_del_usuario)):
    async with pool.connection() as con:
        cur = await con.execute(SQL_VENTAS_VENDEDOR, (empresa_id, desde, hasta))
        filas = await cur.fetchall()
    if formato == "xlsx":
        buffer = io.BytesIO()
        pd.DataFrame(filas).to_excel(buffer, index=False, sheet_name="Ventas")
        buffer.seek(0)
        return StreamingResponse(buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=ventas_por_vendedor.xlsx"})
    return filas

@app.get("/cartera-vencida")
async def cartera_vencida(empresa_id: str = Depends(empresa_del_usuario)):
    # La cartera es el saldo pendiente de las facturas (R7: saldo = total - pagos aplicados)
    async with pool.connection() as con:
        cur = await con.execute(
            """SELECT f.cliente_id::text, f.id::text AS factura_id, f.prefijo || f.numero::text AS factura,
                      f.saldo, f.fecha_vencimiento, (current_date - f.fecha_vencimiento) AS dias_mora
                 FROM facturacion.factura f
                WHERE f.empresa_id = %s AND f.saldo > 0 AND f.estado <> 'ANULADA' AND f.fecha_vencimiento < current_date
                ORDER BY dias_mora DESC""", (empresa_id,))
        return await cur.fetchall()

@app.get("/salud")
async def salud(): return {"estado": "ok"}
