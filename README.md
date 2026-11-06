# CRM Inteligente

Plataforma comercial **Monolito Modular + Clean Architecture + DDD + Offline-First** para los procesos de
**Pedidos** (con Orden de Fabricación automática), **Facturación**, **Caja**, **Inventarios y Fabricación**,
**Compras y Proveedores**, **Despacho** y **Datos maestros**.

| Capa | Tecnología |
|---|---|
| Frontend / PWA | Next.js + React + Dexie (IndexedDB) + Service Worker (Serwist) |
| Backend | NestJS (Node.js + TypeScript), un módulo por proceso |
| Reportes | Python + FastAPI (solo lectura) |
| Datos | PostgreSQL 16 (un esquema por módulo) + Supabase (Auth OAuth 2.0 / Realtime) |
| Despliegue | VPS Ubuntu, Docker Compose, Nginx, Let's Encrypt (`sierrainnova.tech`) |

> La guía completa está en [`docs/GUIA.md`](docs/GUIA.md): arquitectura, las 14 reglas de negocio (R1-R14),
> actores y roles, modelo de datos, estrategia de sincronización y despliegue.

## Estructura

```
apps/api            NestJS: modulos/{pedidos,inventarios,fabricacion,facturacion,caja,compras,despacho,catalogo,seguridad,sincronizacion}
apps/web            Next.js PWA offline-first + tienda
apps/reportes-py    FastAPI de reportes
packages/contratos  Esquemas Zod compartidos (eventos)
db/scripts          Modelo de datos PostgreSQL (SQL numerado)   db/tests  pruebas de reglas en BD
infra               docker-compose, Nginx, backup y deploy
docs                Guía de diseño
```

## Inicio rápido (desarrollo)

Requisitos: Node 22, pnpm 9, Docker, Supabase CLI, `psql`, Python 3.12.

```bash
pnpm install

# 1) Base de datos local (PostgreSQL + Auth + Realtime)
supabase init            # solo la primera vez
supabase start           # muestra URLs, anon key y puerto de la BD (54322)
pnpm db:aplicar          # crea esquemas, tablas, triggers y semillas (db/scripts)
pnpm db:reglas           # comprueba las reglas R3, R5, R8, R9, R10 en la base de datos

# 2) Variables de entorno
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local     # completar NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3) Aplicación
pnpm --filter api dev        # http://localhost:3001/v1/salud
pnpm --filter web dev        # http://localhost:3000

# 4) Reportes (opcional)
cd apps/reportes-py && python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && uvicorn app.main:app --port 8000
```

### Primer usuario

Se crea la empresa y se asocia el usuario autenticado (`auth.users.id`) con el rol `administrador`:

```sql
INSERT INTO seguridad.empresa (id, nit, razon_social) VALUES (gen_random_uuid(), '900000000-1', 'Mi Empresa') RETURNING id;
INSERT INTO seguridad.usuario (id, nombre, correo) VALUES ('<auth.users.id>', 'Admin', 'admin@sierrainnova.tech');
INSERT INTO seguridad.usuario_empresa (usuario_id, empresa_id, rol_id)
  SELECT '<auth.users.id>', '<empresa.id>', id FROM seguridad.rol WHERE codigo = 'administrador';
-- Serie de facturación y de notas de crédito (R14)
INSERT INTO facturacion.serie_documento (empresa_id, tipo, prefijo, numero_resolucion, rango_desde, rango_hasta, ultimo_numero, vigente_hasta)
VALUES ('<empresa.id>', 'FACTURA', 'FE', '000000', 1, 100000, 0, current_date + 365),
       ('<empresa.id>', 'NOTA_CREDITO', 'NC', '000000', 1, 100000, 0, current_date + 365);
```

## Subir a GitHub

```bash
bash subir-a-github.sh     # git init + commit + push a WILSP1971/Apps_ComercialTech (rama main)
```

## Calidad

```bash
pnpm lint:arq     # reglas de arquitectura (dominio no importa infraestructura; módulos solo por su API pública)
pnpm test         # pruebas unitarias del dominio (Pedido, ReferenciaPago)
```

## Despliegue

Ver sección 14 de [`docs/GUIA.md`](docs/GUIA.md) (VPS Ubuntu, Nginx, certificados, Docker Compose) y
`infra/scripts/deploy.sh` (migraciones + despliegue).

## Estado del proyecto

Este repositorio es el **esqueleto inicial** generado a partir de la guía de diseño. Los módulos Pedidos,
Inventarios, Fabricación, Caja, Facturación, Compras, Despacho, Catálogo y Seguridad implementan los casos de uso
clave y las reglas R1-R14. Antes de producción falta: instalar dependencias y correr el *build*/pruebas,
pruebas de integración con PostgreSQL real, UI completa por rol, adaptador de facturación electrónica (DIAN)
y pasarela de pagos.
