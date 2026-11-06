# Guía paso a paso: Monolito Modular + Clean Architecture + DDD + Offline-First

> **Proyecto:** Plataforma comercial con 7 procesos encadenados: Pedidos (con Orden de Fabricación automática), Facturación, Caja, Inventarios y Fabricación, Compras y Proveedores, Despacho y Datos maestros
> **Dominio de despliegue:** `sierrainnova.tech` (VPS Ubuntu)
> **Stack:** Next.js · React · Node.js (NestJS) · Python (FastAPI) · PostgreSQL · Supabase · OAuth 2.0 / OIDC

---

## Índice

1. [Decisiones de arquitectura](#1-decisiones-de-arquitectura)
2. [Arquitectura objetivo](#2-arquitectura-objetivo)
3. [Procesos de negocio, actores, reglas y dominios (DDD)](#3-procesos-de-negocio-actores-reglas-y-dominios-ddd)
4. [Estructura del monorepo](#4-estructura-del-monorepo)
5. [Preparación del entorno](#5-preparación-del-entorno)
6. [Modelo de datos PostgreSQL (scripts SQL)](#6-modelo-de-datos-postgresql-scripts-sql)
7. [Backend: NestJS con Clean Architecture](#7-backend-nestjs-con-clean-architecture)
8. [Autenticación y autorización: OAuth 2.0 / OIDC](#8-autenticación-y-autorización-oauth-20--oidc)
9. [Estrategia Offline-First y sincronización](#9-estrategia-offline-first-y-sincronización)
10. [Frontend: Next.js + React PWA](#10-frontend-nextjs--react-pwa)
11. [Servicio de Reportes en Python](#11-servicio-de-reportes-en-python)
12. [Comunicación entre módulos y eventos](#12-comunicación-entre-módulos-y-eventos)
13. [Pruebas](#13-pruebas)
14. [Despliegue en VPS Ubuntu (sierrainnova.tech)](#14-despliegue-en-vps-ubuntu-sierrainnovatech)
15. [CI/CD, backups y observabilidad](#15-cicd-backups-y-observabilidad)
16. [Hoja de ruta por fases](#16-hoja-de-ruta-por-fases)
17. [Checklist final](#17-checklist-final)

---

## 1. Decisiones de arquitectura

La imagen de referencia indica una "Aplicación modular .NET". Como el requerimiento pide herramientas
de última generación basadas en **Next.js, React, Node.js, Python y OAuth 2.0**, se **reemplaza .NET por
NestJS (Node.js + TypeScript)**, que ofrece el mismo concepto de módulos, inyección de dependencias y capas.

| Tema | Decisión | Motivo |
|---|---|---|
| Estilo | **Monolito modular** (un solo despliegue, módulos aislados) | Menor costo operativo en un VPS; permite extraer módulos a servicios luego |
| Organización interna | **Clean Architecture** por módulo (dominio → aplicación → infraestructura → presentación) | Reglas de negocio independientes de frameworks |
| Modelado | **DDD** (Agregados, Entidades, Value Objects, Eventos de dominio) | Lenguaje ubicuo y reglas claras por contexto |
| Backend | **NestJS (TypeScript)** | Módulos, DI, guards, testing |
| Reportes / analítica | **Python + FastAPI** (servicio auxiliar de solo lectura) | Pandas, exportes Excel/PDF, analítica |
| Frontend | **Next.js (App Router) + React + PWA** | SSR/SPA, Service Worker, instalable |
| Base de datos central | **PostgreSQL 16** en el VPS (fuente de verdad) | Robustez, esquemas por módulo, JSONB |
| Datos locales | **IndexedDB (Dexie)** en el navegador / PWA. Alternativa: PGlite o SQLite-WASM | Operar sin conexión |
| Sincronización | **Outbox local + log de cambios en PostgreSQL + Supabase Realtime** como canal de notificación | Offline-First con resolución de conflictos |
| Autenticación | **OAuth 2.0 / OpenID Connect** (Authorization Code + PKCE) con **Supabase Auth (GoTrue)** como proveedor | JWT firmados, validación por JWKS |
| Infraestructura | **Docker Compose + Nginx + Let's Encrypt** en Ubuntu | Simple y reproducible |

### Del modelo de servicios (`svc_*`) al monolito modular

La referencia de negocio describe siete procesos, cada uno con un "servicio dueño" y una base de datos propia (`svc_pedidos`, `svc_facturacion`, `svc_caja`, `svc_inventarios`, `svc_fabricacion`, `svc_compras`, `svc_despacho`, `svc_catalogo`, `svc_seguridad`). Se conserva esa **propiedad de datos**, pero con despliegue de monolito modular:

| Servicio / BD de la referencia | Módulo NestJS | Esquema PostgreSQL |
|---|---|---|
| `pedidos` / `svc_pedidos` | `modulos/pedidos` | `pedidos` |
| `facturacion` / `svc_facturacion` | `modulos/facturacion` | `facturacion` |
| `caja` / `svc_caja` | `modulos/caja` | `caja` |
| `inventarios` / `svc_inventarios` | `modulos/inventarios` | `inventarios` |
| `fabricacion` / `svc_fabricacion` | `modulos/fabricacion` | `fabricacion` |
| `compras` / `svc_compras` | `modulos/compras` | `compras` |
| `despacho` / `svc_despacho` | `modulos/despacho` | `despacho` |
| `catalogo` / `svc_catalogo` | `modulos/catalogo` | `catalogo` |
| `seguridad` / `svc_seguridad` | `modulos/seguridad` | `seguridad` |

Como no existen llaves foráneas ni `JOIN` entre esquemas, extraer un módulo a su propio servicio y base `svc_*` es un cambio de infraestructura, no de código de negocio.

### Principios que se deben respetar siempre

1. **Cada módulo es dueño de su esquema SQL.** Ningún módulo hace `JOIN` ni `FOREIGN KEY` hacia tablas de otro esquema; solo guarda IDs (UUID) y se comunica por **contratos** o **eventos**.
2. **El dominio no importa nada** de NestJS, `pg`, Next.js ni librerías de infraestructura.
3. **Los IDs se generan en el cliente (UUID v7)** para poder crear registros sin conexión.
4. **Las operaciones críticas se sincronizan como comandos/eventos** (ej. "descontar 3 unidades"), no como estados (ej. "stock = 7"), para evitar pérdidas por conflicto.
5. **Toda escritura es idempotente** (`idempotency_key`) porque el cliente puede reenviar tras un corte de red.
6. **Las reglas de negocio R1–R14 se protegen en dos niveles:** el dominio (mensaje claro al usuario) y la base de datos (CHECK, UNIQUE, triggers) como último guardián ante concurrencia y reintentos. Ver sección 3.4.
7. **Lo que no se puede borrar se corrige con un asiento inverso:** kardex, movimientos de caja y documentos fiscales son inmutables (R5, R6, R9).
8. **Los eventos se procesan "al menos una vez":** todo manejador debe ser idempotente (R4 es el ejemplo: `clave_origen` única).

---

## 2. Arquitectura objetivo

Equivalente a la imagen compartida, adaptada al stack elegido y a los siete procesos de negocio:

```mermaid
flowchart TD
    subgraph Canales["Canales de acceso"]
        W[Aplicación web - Next.js]
        M[Aplicación móvil - PWA]
        P[Mostrador / Punto de venta - PWA Offline]
        E[E-commerce Cliente web - Next.js]
    end

    subgraph Local["Capa local Offline-First - en el dispositivo"]
        SW[Service Worker]
        IDB[(IndexedDB / Dexie)]
        OUT[Outbox de operaciones]
    end

    GW["API Gateway / API REST<br/>Nginx + Autenticación + Autorización + Enrutamiento"]

    subgraph Monolito["Aplicación modular Node.js - NestJS"]
        PE[Pedidos<br/>orquestador]
        IN[Inventarios]
        FB[Fabricación]
        FA[Facturación]
        CJ[Caja]
        CO[Compras y Proveedores]
        DE[Despacho]
        CT[Catálogo]
        SE[Seguridad]
        R[Reportes]
        SYNC[Sincronización]
        K[Kernel compartido]
    end

    PY["Servicio Reportes<br/>Python FastAPI"]
    PG[(PostgreSQL 16<br/>un esquema por módulo)]
    SB[Supabase Auth + Realtime]

    Canales --> Local
    Local -->|HTTPS + JWT| GW
    GW --> Monolito
    Monolito --> PG
    SYNC <--> SB
    R --> PY
    PY --> PG
    GW -. valida JWT con JWKS .-> SB

    PE -->|reserva síncrona - API pública| IN
    PE -. PedidoConfirmado con faltantes .-> FB
    FB -. OrdenFabricacionTerminada .-> IN
    CJ -. CobroRegistrado .-> FA
    CO -. RecepcionRegistrada .-> IN
    DE -->|consume reservas - API pública| IN
```

Flujo resumido:

1. El usuario inicia sesión con OAuth 2.0 (Authorization Code + PKCE). Su rol (vendedor, cajero, bodeguero, etc.) define qué puede hacer y qué datos descarga.
2. La PWA guarda todo en **IndexedDB** y registra cada cambio en el **outbox**.
3. Cuando hay red, el motor de sincronización hace **push** (envía el outbox) y **pull** (descarga cambios del servidor por `secuencia`).
4. El servidor ejecuta los comandos en los módulos de dominio, **valida las reglas R1–R14** y escribe en PostgreSQL. Un trigger registra los cambios en `sync.cambios`.
5. Supabase Realtime avisa a los demás dispositivos que hay cambios y estos hacen `pull`.
6. Los módulos se hablan por **eventos** (outbox transaccional) y, solo cuando se necesita consistencia inmediata (reservar stock, consumir reservas), por la **API pública** de otro módulo.

---

## 3. Procesos de negocio, actores, reglas y dominios (DDD)

### 3.1 Procesos de negocio

El sistema cubre **siete procesos de negocio encadenados**. En la referencia cada proceso tiene un "servicio dueño" con su propia base de datos (`svc_*`). Aquí cada servicio es un **módulo** del monolito y cada base de datos es un **esquema** de PostgreSQL (ver sección 1):

| # | Proceso | Módulo dueño | Esquema PostgreSQL |
|---|---|---|---|
| 1 | **Pedidos** (con generación automática de Orden de Fabricación) | `pedidos` | `pedidos` |
| 2 | **Facturación** | `facturacion` | `facturacion` |
| 3 | **Caja** (tesorería, arqueos) | `caja` | `caja` |
| 4 | **Inventarios y Fabricación** | `inventarios`, `fabricacion` | `inventarios`, `fabricacion` |
| 5 | **Compras y Proveedores** | `compras` | `compras` |
| 6 | **Despacho de mercadería** | `despacho` | `despacho` |
| 7 | **Datos maestros** (artículos, clientes, usuarios) | `catalogo`, `seguridad` | `catalogo`, `seguridad` |

Módulos de soporte: `sincronizacion` (esquema `sync`), `reportes` (solo lectura) y el kernel compartido (esquema `nucleo`: outbox y auditoría).

### 3.2 Bounded Contexts

| Contexto | Responsabilidad | Agregados / entidades principales | Eventos que publica |
|---|---|---|---|
| **Pedidos** | Pedidos, líneas mixtas (stock + fabricación), crédito del cliente, aprobaciones | `Pedido`, `ClienteCredito` | `PedidoRequiereAprobacion`, `PedidoConfirmado`, `PedidoCancelado` |
| **Inventarios** | Existencias por bodega, reservas, kardex, conteos | `Existencia`, `ReservaStock`, `Kardex`, `Conteo` | `StockReservadoPorProduccion`, `AjusteRegistrado` |
| **Fabricación** | Órdenes de fabricación (OF), programación y reporte de producción | `OrdenFabricacion` | `OrdenFabricacionLiberada`, `OrdenFabricacionTerminada` |
| **Facturación** | Facturas, notas de crédito, pagos aplicados, saldo, series fiscales | `Factura`, `NotaCredito`, `SerieDocumento` | `FacturaEmitida`, `FacturaAnulada`, `FacturaPagada` |
| **Caja** | Sesiones de caja, cobros, movimientos, arqueos | `SesionCaja`, `MovimientoCaja`, `Arqueo` | `CobroRegistrado`, `MovimientoReversado`, `SesionCerrada` |
| **Compras** | Proveedores, órdenes de compra, recepción de mercadería | `OrdenCompra`, `Proveedor`, `Recepcion` | `OrdenCompraAprobada`, `RecepcionRegistrada` |
| **Despacho** | Despachos y entregas de mercadería | `Despacho` | `DespachoRealizado`, `DespachoEntregado` |
| **Catálogo** | Datos maestros de artículos y clientes | `Articulo`, `Cliente` | `ClienteCreado`, `ClienteActualizado`, `ArticuloActualizado` |
| **Seguridad** | Usuarios, roles, permisos, empresas | `Usuario`, `Rol` | — |
| **Reportes** | Consultas de solo lectura / analítica | (sin agregados) | — |

### 3.3 Actores, roles y canales

| Actor | Interacción principal | Rol (`seguridad.rol.codigo`) | Canal | ¿Opera offline? |
|---|---|---|---|---|
| **Vendedor (mostrador)** | Crea pedidos, cobra en caja | `vendedor` | PWA mostrador | **Sí** (pedidos y cobros en efectivo) |
| **Cliente web** | Catálogo, carrito, checkout, seguimiento | `cliente_web` | E-commerce Next.js | No (solo caché del catálogo) |
| **Supervisor de ventas** | Aprueba pedidos sobre límite de crédito, cancela | `supervisor_ventas` | Web / PWA | No (la aprobación es una decisión del servidor) |
| **Bodeguero** | Recepción de compras, despacho, conteos | `bodeguero` | PWA móvil | **Sí** (conteos, recepciones; el despacho se valida al sincronizar) |
| **Planificador de producción** | Libera OF, programa producción, reporta cantidades | `planificador_produccion` | Web / PWA | Parcial (reporte de cantidades) |
| **Cajero** | Abre/cierra sesión, cobra, arquea | `cajero` | PWA caja | **Sí** (cobros en efectivo dentro de una sesión ya abierta) |
| **Contador** | Emite/anula facturas, concilia banco, ve cartera | `contador` | Web | No |
| **Comprador** | Gestiona proveedores, crea y aprueba OC | `comprador` | Web / PWA | Parcial (borradores de OC) |
| **Administrador** | Usuarios, roles, catálogos | `administrador` | Web | No |

Observaciones de diseño derivadas de los actores:

- **Un usuario puede tener varios roles** en una empresa (por ejemplo `vendedor` + `cajero`). Los permisos se **unen**.
- **El cliente web no usa el motor de sincronización:** consume endpoints REST `/tienda/*` (catálogo publicado, checkout y seguimiento) y solo ve **sus propios pedidos** (`usuario_empresa.cliente_id`). Es la única identidad externa del sistema.
- **Los pagos con tarjeta requieren conexión** (autorización y token de la pasarela, regla R10). Offline solo se aceptan cobros en efectivo/transferencia dentro de una sesión de caja que ya estaba abierta.
- **Abrir una sesión de caja siempre es en línea** (garantiza la regla R8 de una sola sesión abierta).

### 3.4 Reglas de negocio que el sistema DEBE garantizar

Cada regla se protege en **dos niveles** cuando es posible: el **dominio** (para dar un error claro al usuario) y la **base de datos** (último guardián ante concurrencia, reintentos o bugs).

| # | Regla | Dónde se implementa | Mecanismo |
|---|---|---|---|
| **R1** | Si al confirmar un pedido la cantidad disponible de un artículo es **menor a la pedida**, se debe generar una **Orden de Fabricación por el faltante** | `pedidos` (orquestador) → `fabricacion` | `Pedido.confirmar()` calcula el faltante y emite `PedidoConfirmado`; el handler de Fabricación crea la OF |
| **R2** | Un pedido puede tener **mezcla de líneas**: unas con stock (se reservan) y otras sin stock (generan OF) | `pedidos` | Cada línea guarda `cantidad_reservada` y `cantidad_a_fabricar`; `CHECK` de que no superan la cantidad pedida |
| **R3** | El **stock reservado no puede volver a venderse** | `inventarios.existencia.cantidad_reservada` + CHECK | `cantidad_disponible = fisica − reservada` generada; `CHECK (reservada <= fisica)`; la reserva toma `FOR UPDATE` |
| **R4** | Una OF se genera **como máximo una vez por línea de pedido**, aunque el evento se reintente | `fabricacion.orden_fabricacion.clave_origen` UNIQUE | `clave_origen = 'pedido_linea:<id>'` + `ON CONFLICT DO NOTHING` |
| **R5** | Todo movimiento de inventario deja asiento en el **kardex**; el saldo es siempre derivable | `inventarios.kardex` | Kardex inmutable; la existencia **solo cambia por un trigger** al insertar en el kardex; vista de inconsistencias |
| **R6** | Una factura emitida **no se borra**: se anula con nota de crédito | `facturacion.factura.estado` | Trigger que bloquea `DELETE`, `CHECK (eliminado_en IS NULL)`, anulación solo vía `NotaCredito` |
| **R7** | **Saldo de la factura = total − suma de pagos aplicados** | `facturacion.factura.saldo` + `pago_factura` | Trigger recalcula el saldo en cada pago; `CHECK (saldo BETWEEN 0 AND total)` |
| **R8** | Solo puede existir **una sesión de caja abierta por caja y por usuario** | `caja.sesion_caja` | Columnas generadas `caja_abierta` / `usuario_abierto` + `UNIQUE` |
| **R9** | Un movimiento de caja **nunca se borra**: los errores se corrigen con un movimiento inverso | `caja.movimiento_caja.id_movimiento_relacionado` | Tabla inmutable (trigger) + tipo `REVERSO` validado por trigger |
| **R10** | **No se almacenan datos de tarjeta**: solo token y código de autorización | `caja.movimiento_caja.referencia` | `CHECK` anti-PAN + validación de dominio (Luhn) |
| **R11** | Una Orden de Compra **no se cierra hasta recibir la mercadería** | `compras.orden_compra.estado` | Trigger que valida `cantidad_recibida >= cantidad` al pasar a `CERRADA` |
| **R12** | **No se despacha mercadería sin reserva de stock activa** | `inventarios.reserva_stock.estado` | `InventariosApi.consumirReservas()` solo consume reservas `ACTIVA` |
| **R13** | El cliente con crédito **no puede exceder su límite de crédito** | `pedidos.cliente.limite_credito` (validación de dominio) | `ClienteCredito.excedeLimite()`; si excede, el pedido queda `PENDIENTE_APROBACION` hasta que el supervisor lo apruebe |
| **R14** | La numeración de documentos fiscales es **correlativa y sin saltos** | `facturacion.serie_documento.ultimo_numero` con bloqueo transaccional | Función `siguiente_numero()` con `UPDATE ... RETURNING` en la misma transacción que la factura |

> **Alcance de R1:** si el artículo faltante no es fabricable (`catalogo.articulo.es_fabricable = false`), Fabricación no crea OF y emite `fabricacion.OrdenNoFabricable`; Pedidos marca la línea como pendiente de abastecimiento (el comprador puede generar una OC). Esta bifurcación se define con el negocio.

### 3.5 Flujo principal: pedido con líneas mixtas

```mermaid
sequenceDiagram
    actor V as Vendedor
    actor S as Supervisor
    participant PE as Pedidos
    participant IN as Inventarios
    participant FB as Fabricación
    participant DE as Despacho
    participant FA as Facturación
    participant CJ as Caja

    V->>PE: Confirmar pedido
    PE->>PE: R13 valida límite de crédito
    alt Excede el límite
        PE-->>V: PENDIENTE_APROBACION
        S->>PE: Aprobar pedido
    end
    loop Por cada línea
        PE->>IN: Reservar el menor entre pedida y disponible
        IN-->>PE: Cantidad reservada R2 R3
    end
    PE-->>FB: Evento PedidoConfirmado con faltantes
    FB->>FB: R4 crea una OF por línea con faltante
    FB->>FB: Planificador libera y reporta producción
    FB-->>IN: Evento OrdenFabricacionTerminada
    IN->>IN: Entrada al kardex y reserva para la línea
    IN-->>PE: StockReservadoPorProduccion
    V->>DE: Bodeguero despacha
    DE->>IN: R12 consumir reservas activas
    V->>FA: Contador emite factura R14
    V->>CJ: Cajero registra cobro R8 R9 R10
    CJ-->>FA: CobroRegistrado y pago aplicado R7
```

### 3.6 Mapa de eventos entre contextos

```
Catálogo ──ClienteCreado/Actualizado──► Pedidos (mantiene pedidos.cliente con su límite de crédito)
Pedidos ──(API síncrona) reservar──► Inventarios            [R2, R3]
Pedidos ──PedidoConfirmado (faltantes)──► Fabricación       [R1, R4]
Pedidos ──PedidoCancelado──► Inventarios (libera reservas)
Fabricación ──OrdenFabricacionTerminada──► Inventarios (entrada + reserva) ──StockReservadoPorProduccion──► Pedidos
Compras ──RecepcionRegistrada──► Inventarios (entrada al kardex)
Despacho ──(API síncrona) consumirReservas──► Inventarios   [R12]
Despacho ──DespachoRealizado──► Pedidos (estado DESPACHADO)
Caja ──CobroRegistrado──► Facturación (crea pago_factura y recalcula saldo)   [R7]
Caja ──MovimientoReversado──► Facturación (pago pasa a REVERSADO)             [R9]
Facturación ──FacturaEmitida──► Pedidos (marca facturado) / adaptador DIAN
```

---

## 4. Estructura del monorepo

```
sierrainnova/
├── apps/
│   ├── web/                      # Next.js (PWA, Offline-First) + tienda e-commerce
│   │   ├── src/
│   │   │   ├── app/              # Rutas App Router: /(interno)/..., /tienda/...
│   │   │   ├── features/         # pedidos, caja, inventarios, fabricacion, ... (UI por dominio)
│   │   │   ├── offline/          # db local, outbox, motor de sync
│   │   │   ├── auth/             # cliente OAuth 2.0
│   │   │   └── sw.ts             # Service Worker
│   │   └── public/manifest.webmanifest
│   ├── api/                      # NestJS - monolito modular
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── kernel/           # Shared Kernel (Resultado, RaizAgregado, Dinero, errores)
│   │       ├── infraestructura/  # pg pool, outbox, auth, config
│   │       └── modulos/
│   │           ├── pedidos/
│   │           │   ├── dominio/          # Pedido, ClienteCredito, repos (interfaces)
│   │           │   ├── aplicacion/       # casos de uso, puertos (InventariosPuerto)
│   │           │   ├── infraestructura/  # repos pg, adaptadores a otros módulos
│   │           │   ├── presentacion/     # controllers REST (+ /tienda)
│   │           │   ├── index.ts          # API pública del módulo (PedidosApi)
│   │           │   └── pedidos.module.ts
│   │           ├── inventarios/          # InventariosApi (reservar, consumirReservas)
│   │           ├── fabricacion/
│   │           ├── facturacion/
│   │           ├── caja/
│   │           ├── compras/
│   │           ├── despacho/
│   │           ├── catalogo/
│   │           ├── seguridad/
│   │           ├── reportes/
│   │           └── sincronizacion/
│   └── reportes-py/              # FastAPI (solo lectura)
├── packages/
│   └── contratos/                # Esquemas Zod compartidos web <-> api (comandos y eventos)
├── db/
│   ├── scripts/                  # 000_... 100_... (SQL numerado)
│   └── tests/                    # reglas.sql: pruebas de las reglas R3, R8-R11, R14 a nivel BD
├── infra/
│   ├── docker-compose.yml
│   ├── nginx/
│   └── scripts/                  # backup.sh, deploy.sh
├── .github/workflows/
├── pnpm-workspace.yaml
└── turbo.json
```

**Regla de dependencias dentro de cada módulo** (las flechas indican "puede importar a"):

```
presentacion ──► aplicacion ──► dominio
infraestructura ──► aplicacion / dominio
dominio ──► (nada)
```

Entre módulos: solo se puede importar `modulos/<otro>/index.ts` (su API pública, por ejemplo `InventariosApi`) o escuchar eventos por nombre. En la capa de aplicación, el módulo que consume define un **puerto** (interfaz) y en infraestructura un **adaptador** que llama a la API pública del otro módulo (anti-corrupción). Se verifica automáticamente (ver paso 5.4).

---

## 5. Preparación del entorno

### 5.1 Requisitos locales

- Node.js 22 LTS, `pnpm` 9+
- Python 3.12+
- Docker y Docker Compose
- Supabase CLI (`npm i -g supabase`) para el entorno local
- Git

### 5.2 Crear el monorepo

```bash
mkdir sierrainnova && cd sierrainnova
git init
pnpm init

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

cat > turbo.json <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev":   { "cache": false, "persistent": true },
    "test":  { "dependsOn": ["^build"] },
    "lint":  {}
  }
}
EOF

pnpm add -D -w turbo typescript prettier eslint dependency-cruiser

# Backend
pnpm dlx @nestjs/cli new apps/api --package-manager pnpm --skip-git
# Frontend
pnpm dlx create-next-app@latest apps/web --ts --app --tailwind --src-dir --use-pnpm
# Contratos compartidos
mkdir -p packages/contratos/src && cd packages/contratos && pnpm init && pnpm add zod && cd ../..
```

### 5.3 Base de datos local (PostgreSQL + Supabase)

```bash
# Supabase local: levanta Postgres, Auth (GoTrue), Realtime y Studio
supabase init
supabase start
# Muestra: API URL, DB URL (postgresql://postgres:postgres@127.0.0.1:54322/postgres), anon key, JWT secret
```

Variables de entorno (`apps/api/.env`):

```env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json
JWT_ISSUER=http://127.0.0.1:54321/auth/v1
JWT_AUDIENCE=authenticated
```

### 5.4 Forzar los límites entre módulos (dependency-cruiser)

`.dependency-cruiser.cjs` en la raíz:

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dominio-no-depende-de-nada',
      severity: 'error',
      comment: 'La capa de dominio no puede importar aplicacion, infraestructura ni librerias de framework.',
      from: { path: 'apps/api/src/modulos/[^/]+/dominio' },
      to: { path: ['/aplicacion/', '/infraestructura/', '/presentacion/', 'node_modules/(@nestjs|pg)'] },
    },
    {
      name: 'aplicacion-no-depende-de-infraestructura',
      severity: 'error',
      from: { path: 'apps/api/src/modulos/[^/]+/aplicacion' },
      to: { path: ['/infraestructura/', '/presentacion/'] },
    },
    {
      name: 'modulos-solo-via-api-publica',
      severity: 'error',
      comment: 'Un modulo solo puede importar el index.ts de otro modulo.',
      from: { path: 'apps/api/src/modulos/([^/]+)/' },
      to: {
        path: 'apps/api/src/modulos/([^/]+)/(dominio|aplicacion|infraestructura|presentacion)/',
        pathNot: 'apps/api/src/modulos/$1/',
      },
    },
  ],
};
```

Agregar en `package.json` raíz: `"lint:arq": "depcruise apps/api/src --config .dependency-cruiser.cjs"` y ejecutarlo en CI.

---
## 6. Modelo de datos PostgreSQL (scripts SQL)

### 6.1 Convenciones

- **Un esquema por módulo:** `nucleo`, `sync`, `seguridad`, `catalogo`, `pedidos`, `inventarios`, `fabricacion`, `facturacion`, `caja`, `compras`, `despacho`. Equivalen a las bases `svc_*` de la referencia: si un módulo se extrae a servicio, su esquema se mueve a su propia base sin cambiar código (no hay llaves foráneas cruzadas).
- **Las tablas sincronizables** incluyen `id uuid` (generado en el cliente cuando nace offline) más las columnas de la plantilla `nucleo.plantilla_sync`: `empresa_id`, `version`, `creado_en`, `actualizado_en`, `eliminado_en`. Se incorporan con `LIKE nucleo.plantilla_sync INCLUDING DEFAULTS`.
- **Sin llaves foráneas entre esquemas.** Dentro del mismo esquema sí. Entre esquemas solo se guarda el UUID (referencia lógica).
- **Tablas inmutables** (kardex, movimientos de caja, facturas): triggers que bloquean `UPDATE`/`DELETE`. Además, en producción se debe **revocar `TRUNCATE`** al rol de la aplicación.
- Dinero: `numeric(18,2)`. Cantidades: `numeric(18,3)`.
- Las **restricciones de las reglas** llevan nombres con el número de regla (`ck_r3_...`, `uq_r4_...`) para identificarlas en los errores y en las pruebas.
- Los scripts se numeran y se ejecutan en orden (`db/scripts/`).

### 6.2 `000_extensiones.sql`

```sql
-- db/scripts/000_extensiones.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- textos sin distinguir mayúsculas
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- búsquedas por similitud
```

### 6.3 `001_nucleo.sql` (esquemas, plantilla, outbox, auditoría y sincronización)

```sql
-- db/scripts/001_nucleo.sql
CREATE SCHEMA IF NOT EXISTS nucleo;
CREATE SCHEMA IF NOT EXISTS sync;
CREATE SCHEMA IF NOT EXISTS seguridad;
CREATE SCHEMA IF NOT EXISTS catalogo;
CREATE SCHEMA IF NOT EXISTS pedidos;
CREATE SCHEMA IF NOT EXISTS inventarios;
CREATE SCHEMA IF NOT EXISTS fabricacion;
CREATE SCHEMA IF NOT EXISTS facturacion;
CREATE SCHEMA IF NOT EXISTS caja;
CREATE SCHEMA IF NOT EXISTS compras;
CREATE SCHEMA IF NOT EXISTS despacho;

-- ===== Plantilla de columnas de las tablas sincronizables =====
CREATE TABLE nucleo.plantilla_sync (
  empresa_id      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  eliminado_en    timestamptz
);

-- ===== Funciones de inmutabilidad (R6, R9, R5) =====
CREATE OR REPLACE FUNCTION nucleo.fn_bloquear_modificacion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla %.% es inmutable: no admite % (corrija con un registro inverso)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION nucleo.fn_bloquear_borrado() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'No se pueden borrar registros de %.% (use anulación o un movimiento inverso)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'P0001';
END; $$ LANGUAGE plpgsql;

-- ===== Outbox de eventos de dominio (Transactional Outbox) =====
CREATE TABLE nucleo.evento_outbox (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  tipo           text NOT NULL,              -- 'pedidos.PedidoConfirmado'
  agregado_id    uuid NOT NULL,
  payload        jsonb NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  procesado_en   timestamptz,
  intentos       int NOT NULL DEFAULT 0
);
CREATE INDEX ix_outbox_pendientes ON nucleo.evento_outbox (creado_en) WHERE procesado_en IS NULL;

-- ===== Auditoría =====
CREATE TABLE nucleo.auditoria (
  id          bigserial PRIMARY KEY,
  empresa_id  uuid,
  usuario_id  uuid,
  accion      text NOT NULL,
  entidad     text NOT NULL,
  entidad_id  uuid,
  detalle     jsonb,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

-- ===== Sincronización =====
CREATE TABLE sync.cambios (
  secuencia    bigserial PRIMARY KEY,
  empresa_id   uuid NOT NULL,
  tabla        text NOT NULL,                -- 'pedidos.pedido'
  registro_id  uuid NOT NULL,
  operacion    char(1) NOT NULL CHECK (operacion IN ('I','U','D')),
  version      int NOT NULL,
  payload      jsonb NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cambios_empresa_secuencia ON sync.cambios (empresa_id, secuencia);

CREATE TABLE sync.operacion_procesada (
  idempotency_key  uuid PRIMARY KEY,
  empresa_id       uuid NOT NULL,
  dispositivo_id   uuid NOT NULL,
  tipo             text NOT NULL,
  resultado        jsonb NOT NULL,
  procesado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync.dispositivo (
  id                 uuid PRIMARY KEY,
  empresa_id         uuid NOT NULL,
  usuario_id         uuid NOT NULL,
  nombre             text,
  ultima_sync        timestamptz
);

-- Trigger genérico: controla versión/fechas y registra el cambio en el log.
CREATE OR REPLACE FUNCTION sync.fn_registrar_cambio() RETURNS trigger AS $$
DECLARE
  v_op char(1);
BEGIN
  IF TG_WHEN = 'BEFORE' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.version        := 1;
      NEW.creado_en      := COALESCE(NEW.creado_en, now());
      NEW.actualizado_en := now();
    ELSE
      NEW.version        := OLD.version + 1;
      NEW.actualizado_en := now();
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER: el bloqueo consultivo serializa la asignación de 'secuencia' para que los clientes
  -- no se salten cambios (una secuencia menor confirmada después de una mayor).
  PERFORM pg_advisory_xact_lock(7001);
  v_op := CASE WHEN TG_OP = 'INSERT' THEN 'I'
               WHEN NEW.eliminado_en IS NOT NULL THEN 'D'
               ELSE 'U' END;
  INSERT INTO sync.cambios (empresa_id, tabla, registro_id, operacion, version, payload)
  VALUES (NEW.empresa_id, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, v_op, NEW.version, to_jsonb(NEW));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE PROCEDURE sync.habilitar(p_esquema text, p_tabla text) AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER trg_sync_antes BEFORE INSERT OR UPDATE ON %I.%I
                  FOR EACH ROW EXECUTE FUNCTION sync.fn_registrar_cambio()', p_esquema, p_tabla);
  EXECUTE format('CREATE TRIGGER trg_sync_despues AFTER INSERT OR UPDATE ON %I.%I
                  FOR EACH ROW EXECUTE FUNCTION sync.fn_registrar_cambio()', p_esquema, p_tabla);
END;
$$ LANGUAGE plpgsql;
```

> **Nota de escalabilidad:** el bloqueo consultivo serializa las escrituras sincronizables. Es adecuado para una operación comercial pequeña/mediana en un VPS. Si el volumen crece, migrar a replicación lógica o a un pull con "ventana de solapamiento".

### 6.4 `005_seguridad.sql` (empresas, usuarios, roles y permisos)

```sql
-- db/scripts/005_seguridad.sql
CREATE TABLE seguridad.empresa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit           text NOT NULL UNIQUE,
  razon_social  text NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

-- id = auth.users.id de Supabase Auth (claim "sub" del JWT)
CREATE TABLE seguridad.usuario (
  id         uuid PRIMARY KEY,
  nombre     text NOT NULL,
  correo     citext NOT NULL UNIQUE,
  activo     boolean NOT NULL DEFAULT true,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seguridad.rol (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  text NOT NULL UNIQUE,
  nombre  text NOT NULL
);

CREATE TABLE seguridad.permiso (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  text NOT NULL UNIQUE           -- 'pedidos.pedido.aprobar'
);

CREATE TABLE seguridad.rol_permiso (
  rol_id      uuid NOT NULL REFERENCES seguridad.rol(id),
  permiso_id  uuid NOT NULL REFERENCES seguridad.permiso(id),
  PRIMARY KEY (rol_id, permiso_id)
);

-- Un usuario puede tener VARIOS roles en una empresa (vendedor + cajero).
-- cliente_id solo se usa para el rol 'cliente_web' (referencia lógica a catalogo.cliente).
CREATE TABLE seguridad.usuario_empresa (
  usuario_id  uuid NOT NULL REFERENCES seguridad.usuario(id),
  empresa_id  uuid NOT NULL REFERENCES seguridad.empresa(id),
  rol_id      uuid NOT NULL REFERENCES seguridad.rol(id),
  cliente_id  uuid,
  activo      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (usuario_id, empresa_id, rol_id)
);
```

### 6.5 `010_catalogo.sql` (datos maestros: artículos y clientes)

```sql
-- db/scripts/010_catalogo.sql
CREATE TABLE catalogo.articulo (
  id                uuid PRIMARY KEY,
  sku               text NOT NULL,
  nombre            text NOT NULL,
  descripcion       text,
  unidad_medida     text NOT NULL DEFAULT 'UND',
  precio_lista      numeric(18,2) NOT NULL DEFAULT 0 CHECK (precio_lista >= 0),
  porcentaje_iva    numeric(5,2)  NOT NULL DEFAULT 19,
  es_fabricable     boolean NOT NULL DEFAULT false,   -- R1: si falta stock genera OF
  maneja_inventario boolean NOT NULL DEFAULT true,
  publicado_web     boolean NOT NULL DEFAULT false,   -- visible en el e-commerce
  activo            boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, sku)
);
CREATE INDEX ix_articulo_busqueda ON catalogo.articulo USING gin (nombre gin_trgm_ops);

CREATE TABLE catalogo.cliente (
  id                uuid PRIMARY KEY,
  tipo_documento    text NOT NULL CHECK (tipo_documento IN ('CC','NIT','CE','PAS')),
  numero_documento  text NOT NULL,
  razon_social      text NOT NULL,
  correo            citext,
  telefono          text,
  direccion         text,
  ciudad            text,
  vendedor_id       uuid,                         -- usuario responsable
  activo            boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, tipo_documento, numero_documento)
);
CREATE INDEX ix_cliente_busqueda ON catalogo.cliente USING gin (razon_social gin_trgm_ops);

CALL sync.habilitar('catalogo', 'articulo');
CALL sync.habilitar('catalogo', 'cliente');
```

### 6.6 `020_inventarios.sql` (existencias, reservas y kardex: R3, R5, R12)

```sql
-- db/scripts/020_inventarios.sql
CREATE TABLE inventarios.bodega (
  id        uuid PRIMARY KEY,
  codigo    text NOT NULL,
  nombre    text NOT NULL,
  activa    boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, codigo)
);

-- Existencias: NADIE las modifica directamente; cambian solo por el trigger del kardex (R5).
CREATE TABLE inventarios.existencia (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id          uuid NOT NULL,                       -- referencia lógica a catalogo.articulo
  bodega_id            uuid NOT NULL REFERENCES inventarios.bodega(id),
  cantidad_fisica      numeric(18,3) NOT NULL DEFAULT 0,
  cantidad_reservada   numeric(18,3) NOT NULL DEFAULT 0,
  cantidad_disponible  numeric(18,3) GENERATED ALWAYS AS (cantidad_fisica - cantidad_reservada) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, articulo_id, bodega_id),
  CONSTRAINT ck_existencia_fisica_no_negativa  CHECK (cantidad_fisica >= 0),
  CONSTRAINT ck_existencia_reserva_no_negativa CHECK (cantidad_reservada >= 0),
  -- R3: lo reservado no puede volver a venderse (nunca se reserva más de lo que hay)
  CONSTRAINT ck_r3_reservado_no_excede_fisico  CHECK (cantidad_reservada <= cantidad_fisica)
);

-- R12: reservas de stock por línea de pedido. Despachar = consumir una reserva ACTIVA.
CREATE TABLE inventarios.reserva_stock (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  articulo_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,
  pedido_id         uuid NOT NULL,                          -- referencia lógica a pedidos.pedido
  pedido_linea_id   uuid NOT NULL,
  cantidad          numeric(18,3) NOT NULL CHECK (cantidad > 0),
  estado            text NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','CONSUMIDA','LIBERADA')),
  clave_idempotencia text NOT NULL,                         -- evita reservar dos veces ante reintentos
  referencia_despacho uuid,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, clave_idempotencia)
);
CREATE INDEX ix_reserva_pedido ON inventarios.reserva_stock (pedido_id, estado);

-- R5: kardex inmutable. delta_fisico y delta_reservado permiten derivar siempre el saldo.
CREATE TABLE inventarios.kardex (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  articulo_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN (
                      'ENTRADA_COMPRA','ENTRADA_PRODUCCION','SALIDA_DESPACHO',
                      'AJUSTE_POSITIVO','AJUSTE_NEGATIVO','RESERVA','LIBERACION')),
  delta_fisico      numeric(18,3) NOT NULL DEFAULT 0,
  delta_reservado   numeric(18,3) NOT NULL DEFAULT 0,
  costo_unitario    numeric(18,4),
  referencia_tipo   text,                                   -- 'pedidos.pedido', 'compras.recepcion', 'fabricacion.orden'
  referencia_id     uuid,
  idempotencia      text,
  usuario_id        uuid,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, idempotencia),
  CHECK (delta_fisico <> 0 OR delta_reservado <> 0)
);
CREATE INDEX ix_kardex_articulo ON inventarios.kardex (empresa_id, articulo_id, bodega_id, creado_en DESC);

CREATE TRIGGER trg_kardex_inmutable BEFORE UPDATE OR DELETE ON inventarios.kardex
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

-- R5: toda variación de existencia nace de un asiento del kardex
CREATE OR REPLACE FUNCTION inventarios.fn_aplicar_kardex() RETURNS trigger AS $$
BEGIN
  UPDATE inventarios.existencia
     SET cantidad_fisica    = cantidad_fisica    + NEW.delta_fisico,
         cantidad_reservada = cantidad_reservada + NEW.delta_reservado
   WHERE empresa_id = NEW.empresa_id AND articulo_id = NEW.articulo_id AND bodega_id = NEW.bodega_id;
  IF NOT FOUND THEN
    INSERT INTO inventarios.existencia (empresa_id, articulo_id, bodega_id, cantidad_fisica, cantidad_reservada)
    VALUES (NEW.empresa_id, NEW.articulo_id, NEW.bodega_id, NEW.delta_fisico, NEW.delta_reservado);
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kardex_aplicar AFTER INSERT ON inventarios.kardex
  FOR EACH ROW EXECUTE FUNCTION inventarios.fn_aplicar_kardex();

-- Saldo derivado del kardex y verificación de consistencia (debe devolver 0 filas)
CREATE VIEW inventarios.v_saldo_kardex AS
SELECT empresa_id, articulo_id, bodega_id,
       sum(delta_fisico) AS saldo_fisico, sum(delta_reservado) AS saldo_reservado
  FROM inventarios.kardex GROUP BY empresa_id, articulo_id, bodega_id;

CREATE VIEW inventarios.v_inconsistencias_kardex AS
SELECT e.empresa_id, e.articulo_id, e.bodega_id,
       e.cantidad_fisica, COALESCE(k.saldo_fisico, 0) AS kardex_fisico,
       e.cantidad_reservada, COALESCE(k.saldo_reservado, 0) AS kardex_reservado
  FROM inventarios.existencia e
  LEFT JOIN inventarios.v_saldo_kardex k USING (empresa_id, articulo_id, bodega_id)
 WHERE e.cantidad_fisica <> COALESCE(k.saldo_fisico, 0)
    OR e.cantidad_reservada <> COALESCE(k.saldo_reservado, 0);

-- Conteos físicos (bodeguero). Al cerrar el conteo se generan ajustes en el kardex.
CREATE TABLE inventarios.conteo (
  id            uuid PRIMARY KEY,
  bodega_id     uuid NOT NULL REFERENCES inventarios.bodega(id),
  estado        text NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','CERRADO')),
  realizado_por uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);
CREATE TABLE inventarios.conteo_linea (
  id                uuid PRIMARY KEY,
  conteo_id         uuid NOT NULL REFERENCES inventarios.conteo(id),
  articulo_id       uuid NOT NULL,
  cantidad_sistema  numeric(18,3) NOT NULL,
  cantidad_contada  numeric(18,3) NOT NULL CHECK (cantidad_contada >= 0),
  diferencia        numeric(18,3) GENERATED ALWAYS AS (cantidad_contada - cantidad_sistema) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CALL sync.habilitar('inventarios', 'bodega');
CALL sync.habilitar('inventarios', 'existencia');
CALL sync.habilitar('inventarios', 'conteo');
CALL sync.habilitar('inventarios', 'conteo_linea');
```

### 6.7 `030_pedidos.sql` (pedidos con líneas mixtas y crédito: R1, R2, R13)

```sql
-- db/scripts/030_pedidos.sql

-- Modelo de cliente propio del contexto Pedidos (se alimenta con eventos de catalogo.cliente).
-- Aquí vive el límite de crédito (R13).
CREATE TABLE pedidos.cliente (
  id                uuid PRIMARY KEY,                       -- = catalogo.cliente.id
  numero_documento  text NOT NULL,
  razon_social      text NOT NULL,
  limite_credito    numeric(18,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
  credito_usado     numeric(18,2) NOT NULL DEFAULT 0 CHECK (credito_usado >= 0),
  bloqueado         boolean NOT NULL DEFAULT false,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE pedidos.pedido (
  id                uuid PRIMARY KEY,
  numero            text,                                   -- lo asigna el servidor al confirmar
  cliente_id        uuid NOT NULL REFERENCES pedidos.cliente(id),
  vendedor_id       uuid NOT NULL,
  bodega_id         uuid NOT NULL,                          -- referencia lógica a inventarios.bodega
  canal             text NOT NULL DEFAULT 'MOSTRADOR' CHECK (canal IN ('MOSTRADOR','WEB','TELEFONO')),
  condicion_pago    text NOT NULL DEFAULT 'CONTADO' CHECK (condicion_pago IN ('CONTADO','CREDITO')),
  estado            text NOT NULL DEFAULT 'BORRADOR'
                    CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','CONFIRMADO','DESPACHADO','CANCELADO','RECHAZADO')),
  motivo_rechazo    text,
  direccion_entrega text,
  observaciones     text,
  subtotal          numeric(18,2) NOT NULL DEFAULT 0,
  impuestos         numeric(18,2) NOT NULL DEFAULT 0,
  total             numeric(18,2) NOT NULL DEFAULT 0,
  moneda            char(3) NOT NULL DEFAULT 'COP',
  factura_id        uuid,                                   -- referencia lógica a facturacion.factura
  creado_offline    boolean NOT NULL DEFAULT false,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, numero)
);
CREATE INDEX ix_pedido_cliente ON pedidos.pedido (empresa_id, cliente_id, creado_en DESC);
CREATE INDEX ix_pedido_estado  ON pedidos.pedido (empresa_id, estado);

-- R2: cada línea puede tener una parte reservada de stock y otra parte a fabricar
CREATE TABLE pedidos.pedido_linea (
  id                    uuid PRIMARY KEY,
  pedido_id             uuid NOT NULL REFERENCES pedidos.pedido(id),
  articulo_id           uuid NOT NULL,                      -- referencia lógica a catalogo.articulo
  descripcion           text NOT NULL,
  cantidad              numeric(18,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario       numeric(18,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento_pct         numeric(5,2)  NOT NULL DEFAULT 0 CHECK (descuento_pct BETWEEN 0 AND 100),
  iva_pct               numeric(5,2)  NOT NULL DEFAULT 0,
  total_linea           numeric(18,2) NOT NULL,
  cantidad_reservada    numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_reservada >= 0),
  cantidad_a_fabricar   numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_a_fabricar >= 0),
  estado_abastecimiento text NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado_abastecimiento IN ('PENDIENTE','RESERVADO','EN_FABRICACION','MIXTO')),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r2_reservado_mas_fabricar CHECK (cantidad_reservada + cantidad_a_fabricar <= cantidad)
);
CREATE INDEX ix_pedido_linea_pedido ON pedidos.pedido_linea (pedido_id);

-- Trazabilidad de aprobaciones del supervisor (R13)
CREATE TABLE pedidos.aprobacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        uuid NOT NULL REFERENCES pedidos.pedido(id),
  motivo           text NOT NULL DEFAULT 'LIMITE_CREDITO',
  valor_excedido   numeric(18,2) NOT NULL,
  decision         text CHECK (decision IN ('APROBADO','RECHAZADO')),
  decidida_por     uuid,
  decidida_en      timestamptz,
  comentario       text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE pedidos.consecutivo (
  empresa_id uuid NOT NULL,
  serie      text NOT NULL,
  ultimo     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie)
);

CALL sync.habilitar('pedidos', 'cliente');
CALL sync.habilitar('pedidos', 'pedido');
CALL sync.habilitar('pedidos', 'pedido_linea');
CALL sync.habilitar('pedidos', 'aprobacion');
```

### 6.8 `035_fabricacion.sql` (órdenes de fabricación: R4)

```sql
-- db/scripts/035_fabricacion.sql
CREATE SEQUENCE fabricacion.seq_orden_fabricacion;

CREATE TABLE fabricacion.orden_fabricacion (
  id                 uuid PRIMARY KEY,
  numero             text NOT NULL,
  articulo_id        uuid NOT NULL,                         -- referencia lógica a catalogo.articulo
  cantidad           numeric(18,3) NOT NULL CHECK (cantidad > 0),
  cantidad_producida numeric(18,3) NOT NULL DEFAULT 0 CHECK (cantidad_producida >= 0),
  estado             text NOT NULL DEFAULT 'PLANIFICADA'
                     CHECK (estado IN ('PLANIFICADA','LIBERADA','EN_PROCESO','TERMINADA','CANCELADA')),
  pedido_id          uuid,                                  -- origen (referencia lógica)
  pedido_linea_id    uuid,
  clave_origen       text NOT NULL,                         -- 'pedido_linea:<uuid>' o 'manual:<uuid>'
  bodega_destino_id  uuid NOT NULL,
  fecha_programada   date,
  liberada_por       uuid,
  liberada_en        timestamptz,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, numero),
  -- R4: una OF por línea de pedido como máximo, aunque el evento se reintente
  CONSTRAINT uq_r4_clave_origen UNIQUE (empresa_id, clave_origen)
);
CREATE INDEX ix_of_estado ON fabricacion.orden_fabricacion (empresa_id, estado);

-- Reportes de producción (inmutables, idempotentes)
CREATE TABLE fabricacion.reporte_produccion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  orden_id         uuid NOT NULL REFERENCES fabricacion.orden_fabricacion(id),
  cantidad         numeric(18,3) NOT NULL CHECK (cantidad > 0),
  reportado_por    uuid NOT NULL,
  idempotency_key  uuid NOT NULL UNIQUE,
  creado_en        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_reporte_inmutable BEFORE UPDATE OR DELETE ON fabricacion.reporte_produccion
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

CALL sync.habilitar('fabricacion', 'orden_fabricacion');
```

### 6.9 `040_compras.sql` (R11)

```sql
-- db/scripts/040_compras.sql
CREATE TABLE compras.proveedor (
  id            uuid PRIMARY KEY,
  nit           text NOT NULL,
  razon_social  text NOT NULL,
  correo        citext,
  telefono      text,
  plazo_dias    int NOT NULL DEFAULT 0,
  activo        boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, nit)
);

CREATE TABLE compras.orden_compra (
  id            uuid PRIMARY KEY,
  numero        text,
  proveedor_id  uuid NOT NULL REFERENCES compras.proveedor(id),
  bodega_id     uuid NOT NULL,
  estado        text NOT NULL DEFAULT 'BORRADOR'
                CHECK (estado IN ('BORRADOR','PENDIENTE_APROBACION','APROBADA','ENVIADA',
                                  'RECIBIDA_PARCIAL','RECIBIDA','CERRADA','ANULADA')),
  total         numeric(18,2) NOT NULL DEFAULT 0,
  creado_por    uuid NOT NULL,
  aprobado_por  uuid,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE compras.orden_compra_linea (
  id                 uuid PRIMARY KEY,
  orden_id           uuid NOT NULL REFERENCES compras.orden_compra(id),
  articulo_id        uuid NOT NULL,
  cantidad           numeric(18,3) NOT NULL CHECK (cantidad > 0),
  cantidad_recibida  numeric(18,3) NOT NULL DEFAULT 0,
  costo_unitario     numeric(18,4) NOT NULL CHECK (costo_unitario >= 0),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad)
);

CREATE TABLE compras.recepcion (
  id            uuid PRIMARY KEY,
  orden_id      uuid NOT NULL REFERENCES compras.orden_compra(id),
  recibido_por  uuid NOT NULL,
  observaciones text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE TABLE compras.recepcion_linea (
  id                uuid PRIMARY KEY,
  recepcion_id      uuid NOT NULL REFERENCES compras.recepcion(id),
  orden_linea_id    uuid NOT NULL REFERENCES compras.orden_compra_linea(id),
  articulo_id       uuid NOT NULL,
  cantidad          numeric(18,3) NOT NULL CHECK (cantidad > 0),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- R11: una orden de compra no se cierra hasta recibir toda la mercadería
CREATE OR REPLACE FUNCTION compras.fn_validar_cierre_oc() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM compras.orden_compra_linea l
              WHERE l.orden_id = NEW.id AND l.eliminado_en IS NULL AND l.cantidad_recibida < l.cantidad) THEN
    RAISE EXCEPTION 'R11: la orden de compra % no puede cerrarse: hay mercadería sin recibir', COALESCE(NEW.numero, NEW.id::text)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r11_cierre_oc BEFORE UPDATE OF estado ON compras.orden_compra
  FOR EACH ROW WHEN (NEW.estado = 'CERRADA' AND OLD.estado IS DISTINCT FROM 'CERRADA')
  EXECUTE FUNCTION compras.fn_validar_cierre_oc();

CALL sync.habilitar('compras', 'proveedor');
CALL sync.habilitar('compras', 'orden_compra');
CALL sync.habilitar('compras', 'orden_compra_linea');
CALL sync.habilitar('compras', 'recepcion');
CALL sync.habilitar('compras', 'recepcion_linea');
```

> El trigger sobre `orden_compra` se ejecuta **antes** de actualizar el estado, por lo que la validación debe hacerse con las líneas ya actualizadas en la misma transacción (el caso de uso de recepción actualiza primero las líneas y luego el estado).

### 6.10 `050_facturacion.sql` (R6, R7, R14)

```sql
-- db/scripts/050_facturacion.sql

-- R14: serie de numeración fiscal. El número se toma con bloqueo transaccional.
CREATE TABLE facturacion.serie_documento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('FACTURA','NOTA_CREDITO')),
  prefijo            text NOT NULL,
  numero_resolucion  text NOT NULL,
  rango_desde        bigint NOT NULL,
  rango_hasta        bigint NOT NULL,
  ultimo_numero      bigint NOT NULL,                      -- inicia en rango_desde - 1
  vigente_hasta      date NOT NULL,
  activa             boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, tipo, prefijo),
  CHECK (ultimo_numero >= rango_desde - 1 AND ultimo_numero <= rango_hasta)
);

-- Se invoca DENTRO de la misma transacción que inserta el documento. El UPDATE toma el bloqueo
-- de fila hasta el COMMIT: si la transacción falla, el número se revierte (no hay saltos) y
-- las emisiones concurrentes se serializan (no hay duplicados).
CREATE OR REPLACE FUNCTION facturacion.siguiente_numero(p_empresa uuid, p_tipo text, p_prefijo text)
RETURNS bigint AS $$
DECLARE v bigint;
BEGIN
  UPDATE facturacion.serie_documento
     SET ultimo_numero = ultimo_numero + 1
   WHERE empresa_id = p_empresa AND tipo = p_tipo AND prefijo = p_prefijo
     AND activa AND vigente_hasta >= current_date AND ultimo_numero < rango_hasta
  RETURNING ultimo_numero INTO v;
  IF v IS NULL THEN
    RAISE EXCEPTION 'R14: la serie % (%) no está disponible, vencida o agotada', p_prefijo, p_tipo USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END; $$ LANGUAGE plpgsql;

CREATE TABLE facturacion.factura (
  id                  uuid PRIMARY KEY,
  serie_id            uuid NOT NULL REFERENCES facturacion.serie_documento(id),
  prefijo             text NOT NULL,
  numero              bigint NOT NULL,
  pedido_id           uuid NOT NULL,                        -- referencia lógica a pedidos.pedido
  cliente_id          uuid NOT NULL,
  estado              text NOT NULL DEFAULT 'EMITIDA'
                      CHECK (estado IN ('EMITIDA','PAGADA_PARCIAL','PAGADA','ANULADA')),
  subtotal            numeric(18,2) NOT NULL,
  impuestos           numeric(18,2) NOT NULL,
  total               numeric(18,2) NOT NULL CHECK (total >= 0),
  saldo               numeric(18,2) NOT NULL,
  cufe                text,                                 -- validación del proveedor de facturación electrónica
  fecha_emision       timestamptz NOT NULL DEFAULT now(),
  fecha_vencimiento   date NOT NULL,
  emitida_por         uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, prefijo, numero),
  CONSTRAINT ck_r7_saldo_en_rango CHECK (saldo >= 0 AND saldo <= total),
  CONSTRAINT ck_r6_anulada_sin_saldo CHECK (estado <> 'ANULADA' OR saldo = 0),
  CONSTRAINT ck_r6_nunca_eliminada CHECK (eliminado_en IS NULL)      -- R6: no se borra, ni lógicamente
);
CREATE UNIQUE INDEX uq_factura_pedido_vigente ON facturacion.factura (empresa_id, pedido_id) WHERE estado <> 'ANULADA';
CREATE INDEX ix_factura_cliente ON facturacion.factura (empresa_id, cliente_id, estado);
CREATE INDEX ix_factura_cartera ON facturacion.factura (empresa_id, fecha_vencimiento) WHERE saldo > 0;

CREATE TABLE facturacion.factura_linea (
  id               uuid PRIMARY KEY,
  factura_id       uuid NOT NULL REFERENCES facturacion.factura(id),
  articulo_id      uuid NOT NULL,
  descripcion      text NOT NULL,
  cantidad         numeric(18,3) NOT NULL,
  precio_unitario  numeric(18,2) NOT NULL,
  iva_pct          numeric(5,2) NOT NULL,
  total_linea      numeric(18,2) NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r6_linea_nunca_eliminada CHECK (eliminado_en IS NULL)
);

-- R7: saldo = total - suma de pagos aplicados
CREATE TABLE facturacion.pago_factura (
  id                  uuid PRIMARY KEY,
  factura_id          uuid NOT NULL REFERENCES facturacion.factura(id),
  movimiento_caja_id  uuid NOT NULL UNIQUE,                 -- referencia lógica a caja.movimiento_caja (idempotencia)
  valor               numeric(18,2) NOT NULL CHECK (valor > 0),
  medio_pago          text NOT NULL,
  estado              text NOT NULL DEFAULT 'APLICADO' CHECK (estado IN ('APLICADO','REVERSADO')),
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CREATE OR REPLACE FUNCTION facturacion.fn_recalcular_saldo() RETURNS trigger AS $$
BEGIN
  WITH s AS (
    SELECT f.id,
           f.total - COALESCE((SELECT sum(p.valor) FROM facturacion.pago_factura p
                                WHERE p.factura_id = f.id AND p.estado = 'APLICADO'), 0) AS nuevo_saldo
      FROM facturacion.factura f
     WHERE f.id = NEW.factura_id AND f.estado <> 'ANULADA'
  )
  UPDATE facturacion.factura f
     SET saldo  = s.nuevo_saldo,                              -- si el pago excede el total, el CHECK ck_r7 lo rechaza
         estado = CASE WHEN s.nuevo_saldo = 0 THEN 'PAGADA'
                       WHEN s.nuevo_saldo < f.total THEN 'PAGADA_PARCIAL'
                       ELSE 'EMITIDA' END
    FROM s WHERE f.id = s.id;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r7_saldo AFTER INSERT OR UPDATE OF valor, estado ON facturacion.pago_factura
  FOR EACH ROW EXECUTE FUNCTION facturacion.fn_recalcular_saldo();

CREATE TABLE facturacion.nota_credito (
  id          uuid PRIMARY KEY,
  factura_id  uuid NOT NULL REFERENCES facturacion.factura(id),
  prefijo     text NOT NULL,
  numero      bigint NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('ANULACION_TOTAL','PARCIAL')),
  motivo      text NOT NULL,
  total       numeric(18,2) NOT NULL CHECK (total > 0),
  emitida_por uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, prefijo, numero),
  CONSTRAINT ck_r6_nc_nunca_eliminada CHECK (eliminado_en IS NULL)
);

-- R6: los documentos fiscales no se borran
CREATE TRIGGER trg_r6_no_borrar_factura  BEFORE DELETE ON facturacion.factura
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_linea    BEFORE DELETE ON facturacion.factura_linea
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_nc       BEFORE DELETE ON facturacion.nota_credito
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();
CREATE TRIGGER trg_r6_no_borrar_pago     BEFORE DELETE ON facturacion.pago_factura
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_borrado();

CALL sync.habilitar('facturacion', 'factura');
CALL sync.habilitar('facturacion', 'factura_linea');
CALL sync.habilitar('facturacion', 'pago_factura');
CALL sync.habilitar('facturacion', 'nota_credito');
```

> **Facturación electrónica:** la numeración **siempre la asigna el servidor** (R14). El POS offline registra el *pedido* (y el cobro), y la factura se emite al sincronizar. Si el negocio exige factura inmediata sin red, asignar a cada terminal un **rango reservado** de consecutivos (una `serie_documento` por terminal) antes de quedar offline. La transmisión a la DIAN se hace mediante un proveedor tecnológico autorizado, desde un adaptador que consume el evento `FacturaEmitida` (reintentable).

### 6.11 `060_caja.sql` (R8, R9, R10)

```sql
-- db/scripts/060_caja.sql
CREATE TABLE caja.caja (
  id        uuid PRIMARY KEY,
  codigo    text NOT NULL,
  nombre    text NOT NULL,
  activa    boolean NOT NULL DEFAULT true,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE caja.sesion_caja (
  id                      uuid PRIMARY KEY,
  caja_id                 uuid NOT NULL REFERENCES caja.caja(id),
  usuario_id              uuid NOT NULL,
  estado                  text NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA','CERRADA')),
  monto_apertura          numeric(18,2) NOT NULL DEFAULT 0 CHECK (monto_apertura >= 0),
  abierta_en              timestamptz NOT NULL DEFAULT now(),
  cerrada_en              timestamptz,
  monto_cierre_declarado  numeric(18,2),
  monto_cierre_sistema    numeric(18,2),
  diferencia              numeric(18,2),
  -- R8: columnas generadas que solo tienen valor mientras la sesión está ABIERTA.
  -- UNIQUE permite muchos NULL (sesiones cerradas) y un único valor (sesión abierta).
  caja_abierta     uuid GENERATED ALWAYS AS (CASE WHEN estado = 'ABIERTA' THEN caja_id END) STORED,
  usuario_abierto  uuid GENERATED ALWAYS AS (CASE WHEN estado = 'ABIERTA' THEN usuario_id END) STORED,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT uq_r8_una_abierta_por_caja    UNIQUE (caja_abierta),
  CONSTRAINT uq_r8_una_abierta_por_usuario UNIQUE (usuario_abierto),
  CHECK (estado = 'ABIERTA' OR cerrada_en IS NOT NULL)
);

-- R9 y R10: movimientos inmutables; los errores se corrigen con un REVERSO
CREATE TABLE caja.movimiento_caja (
  id                        uuid PRIMARY KEY,
  sesion_id                 uuid NOT NULL REFERENCES caja.sesion_caja(id),
  tipo                      text NOT NULL CHECK (tipo IN ('COBRO','PAGO','INGRESO','EGRESO','REVERSO')),
  sentido                   text NOT NULL CHECK (sentido IN ('ENTRADA','SALIDA')),
  medio_pago                text NOT NULL CHECK (medio_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA','CHEQUE')),
  valor                     numeric(18,2) NOT NULL CHECK (valor > 0),
  -- R10: solo token / código de autorización de la pasarela. Nunca el número de tarjeta.
  referencia                text,
  pedido_id                 uuid,
  factura_id                uuid,
  id_movimiento_relacionado uuid REFERENCES caja.movimiento_caja(id),   -- R9
  idempotency_key           uuid NOT NULL UNIQUE,
  usuario_id                uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS,
  CONSTRAINT ck_r9_reverso_referencia CHECK ((tipo = 'REVERSO') = (id_movimiento_relacionado IS NOT NULL)),
  CONSTRAINT uq_r9_un_reverso_por_movimiento UNIQUE (id_movimiento_relacionado),
  CONSTRAINT ck_r10_tarjeta_requiere_referencia CHECK (medio_pago <> 'TARJETA' OR (referencia IS NOT NULL AND length(referencia) >= 6)),
  CONSTRAINT ck_r10_referencia_no_es_pan CHECK (referencia IS NULL OR regexp_replace(referencia, '[ -]', '', 'g') !~ '^[0-9]{13,19}$')
);
CREATE INDEX ix_mov_sesion ON caja.movimiento_caja (sesion_id, creado_en);

CREATE TRIGGER trg_r9_inmutable BEFORE UPDATE OR DELETE ON caja.movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION nucleo.fn_bloquear_modificacion();

-- R9: el reverso debe ser exactamente inverso del movimiento original
CREATE OR REPLACE FUNCTION caja.fn_validar_reverso() RETURNS trigger AS $$
DECLARE o caja.movimiento_caja%ROWTYPE;
BEGIN
  IF NEW.tipo <> 'REVERSO' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM caja.movimiento_caja WHERE id = NEW.id_movimiento_relacionado;
  IF NOT FOUND OR o.empresa_id <> NEW.empresa_id THEN
    RAISE EXCEPTION 'R9: el movimiento a reversar no existe' USING ERRCODE = '23514';
  END IF;
  IF o.tipo = 'REVERSO' THEN
    RAISE EXCEPTION 'R9: no se puede reversar un reverso' USING ERRCODE = '23514';
  END IF;
  IF o.sentido = NEW.sentido OR o.valor <> NEW.valor OR o.medio_pago <> NEW.medio_pago THEN
    RAISE EXCEPTION 'R9: el reverso debe tener sentido contrario y el mismo valor y medio de pago' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_r9_validar_reverso BEFORE INSERT ON caja.movimiento_caja
  FOR EACH ROW EXECUTE FUNCTION caja.fn_validar_reverso();

-- Arqueos (parciales y de cierre)
CREATE TABLE caja.arqueo (
  id                uuid PRIMARY KEY,
  sesion_id         uuid NOT NULL REFERENCES caja.sesion_caja(id),
  tipo              text NOT NULL CHECK (tipo IN ('PARCIAL','CIERRE')),
  efectivo_contado  numeric(18,2) NOT NULL CHECK (efectivo_contado >= 0),
  efectivo_esperado numeric(18,2) NOT NULL,
  diferencia        numeric(18,2) GENERATED ALWAYS AS (efectivo_contado - efectivo_esperado) STORED,
  denominaciones    jsonb,                                  -- {"50000": 10, "20000": 5, ...}
  observacion       text,
  arqueado_por      uuid NOT NULL,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- Saldo de efectivo esperado de una sesión (apertura + entradas - salidas en efectivo)
CREATE VIEW caja.v_saldo_efectivo_sesion AS
SELECT s.id AS sesion_id, s.empresa_id,
       s.monto_apertura + COALESCE(sum(CASE WHEN m.sentido = 'ENTRADA' THEN m.valor ELSE -m.valor END)
                                   FILTER (WHERE m.medio_pago = 'EFECTIVO'), 0) AS efectivo_esperado
  FROM caja.sesion_caja s LEFT JOIN caja.movimiento_caja m ON m.sesion_id = s.id
 GROUP BY s.id, s.empresa_id, s.monto_apertura;

CALL sync.habilitar('caja', 'caja');
CALL sync.habilitar('caja', 'sesion_caja');
CALL sync.habilitar('caja', 'movimiento_caja');
CALL sync.habilitar('caja', 'arqueo');
```

### 6.12 `070_despacho.sql` (R12)

```sql
-- db/scripts/070_despacho.sql
CREATE TABLE despacho.despacho (
  id                 uuid PRIMARY KEY,
  numero             text,
  pedido_id          uuid NOT NULL,                         -- referencia lógica a pedidos.pedido
  cliente_id         uuid NOT NULL,
  bodega_id          uuid NOT NULL,
  direccion_entrega  text NOT NULL,
  estado             text NOT NULL DEFAULT 'PROGRAMADO'
                     CHECK (estado IN ('PROGRAMADO','DESPACHADO','ENTREGADO','FALLIDO')),
  transportador      text,
  guia               text,
  despachado_por     uuid,
  despachado_en      timestamptz,
  entregado_en       timestamptz,
  evidencia_url      text,
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

-- R12: cada línea despachada exige la reserva de stock que respalda la salida.
-- La validación de que la reserva esté ACTIVA la hace InventariosApi.consumirReservas()
-- en la misma transacción (no hay FK entre esquemas).
CREATE TABLE despacho.despacho_linea (
  id               uuid PRIMARY KEY,
  despacho_id      uuid NOT NULL REFERENCES despacho.despacho(id),
  pedido_linea_id  uuid NOT NULL,
  articulo_id      uuid NOT NULL,
  cantidad         numeric(18,3) NOT NULL CHECK (cantidad > 0),
  reserva_id       uuid NOT NULL,                           -- reserva consumida
  LIKE nucleo.plantilla_sync INCLUDING DEFAULTS
);

CALL sync.habilitar('despacho', 'despacho');
CALL sync.habilitar('despacho', 'despacho_linea');
```

### 6.13 `080_seguridad_rls.sql` (Row Level Security para Supabase)

El backend usa un rol propietario de las tablas (no sujeto a RLS). Si algún cliente consulta directamente por Supabase
(por ejemplo, Realtime), las políticas garantizan el aislamiento por empresa.

```sql
-- db/scripts/080_seguridad_rls.sql
CREATE OR REPLACE FUNCTION seguridad.empresas_del_usuario() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT empresa_id FROM seguridad.usuario_empresa WHERE usuario_id = auth.uid() AND activo
$$;

-- Lectura por empresa en todas las tablas con empresa_id
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_schema, table_name FROM information_schema.columns
    WHERE column_name = 'empresa_id'
      AND table_schema IN ('catalogo','pedidos','inventarios','fabricacion','facturacion','caja','compras','despacho')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format($f$CREATE POLICY p_lectura_empresa ON %I.%I FOR SELECT TO authenticated
                      USING (empresa_id IN (SELECT seguridad.empresas_del_usuario()))$f$,
                   t.table_schema, t.table_name);
  END LOOP;
END $$;

-- Tabla "señal" liviana: Realtime avisa de cambios sin exponer datos de negocio
CREATE TABLE IF NOT EXISTS sync.senal (
  empresa_id  uuid PRIMARY KEY,
  secuencia   bigint NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sync.senal ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_senal_lectura ON sync.senal FOR SELECT TO authenticated
  USING (empresa_id IN (SELECT seguridad.empresas_del_usuario()));
ALTER PUBLICATION supabase_realtime ADD TABLE sync.senal;

CREATE OR REPLACE FUNCTION sync.fn_actualizar_senal() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync.senal (empresa_id, secuencia) VALUES (NEW.empresa_id, NEW.secuencia)
  ON CONFLICT (empresa_id) DO UPDATE SET secuencia = EXCLUDED.secuencia, actualizado = now();
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_senal AFTER INSERT ON sync.cambios
FOR EACH ROW EXECUTE FUNCTION sync.fn_actualizar_senal();
```

### 6.14 `090_semillas.sql` (roles y permisos por actor)

```sql
-- db/scripts/090_semillas.sql
INSERT INTO seguridad.rol (codigo, nombre) VALUES
  ('vendedor','Vendedor (mostrador)'), ('cliente_web','Cliente web'),
  ('supervisor_ventas','Supervisor de ventas'), ('bodeguero','Bodeguero'),
  ('planificador_produccion','Planificador de producción'), ('cajero','Cajero'),
  ('contador','Contador'), ('comprador','Comprador'), ('administrador','Administrador')
ON CONFLICT DO NOTHING;

INSERT INTO seguridad.permiso (codigo) VALUES
  ('pedidos.pedido.crear'), ('pedidos.pedido.confirmar'), ('pedidos.pedido.aprobar'), ('pedidos.pedido.cancelar'),
  ('tienda.catalogo.ver'), ('tienda.checkout.crear'), ('tienda.pedido.seguimiento'),
  ('inventarios.existencia.ver'), ('inventarios.conteo.registrar'), ('inventarios.ajuste.registrar'),
  ('fabricacion.orden.liberar'), ('fabricacion.orden.programar'), ('fabricacion.orden.reportar'),
  ('caja.sesion.abrir'), ('caja.sesion.cerrar'), ('caja.cobro.registrar'),
  ('caja.arqueo.realizar'), ('caja.movimiento.reversar'),
  ('facturacion.factura.emitir'), ('facturacion.factura.anular'),
  ('facturacion.conciliacion.realizar'), ('facturacion.cartera.ver'),
  ('compras.proveedor.gestionar'), ('compras.orden.crear'), ('compras.orden.aprobar'), ('compras.recepcion.registrar'),
  ('despacho.despacho.gestionar'),
  ('catalogo.articulo.gestionar'), ('catalogo.cliente.gestionar'),
  ('seguridad.usuario.gestionar'), ('seguridad.rol.gestionar'),
  ('reportes.ver')
ON CONFLICT DO NOTHING;

INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
  FROM (VALUES
    ('vendedor','pedidos.pedido.crear'), ('vendedor','pedidos.pedido.confirmar'),
    ('vendedor','inventarios.existencia.ver'), ('vendedor','caja.cobro.registrar'),
    ('cliente_web','tienda.catalogo.ver'), ('cliente_web','tienda.checkout.crear'), ('cliente_web','tienda.pedido.seguimiento'),
    ('supervisor_ventas','pedidos.pedido.aprobar'), ('supervisor_ventas','pedidos.pedido.cancelar'),
    ('supervisor_ventas','pedidos.pedido.crear'), ('supervisor_ventas','pedidos.pedido.confirmar'), ('supervisor_ventas','reportes.ver'),
    ('bodeguero','compras.recepcion.registrar'), ('bodeguero','despacho.despacho.gestionar'),
    ('bodeguero','inventarios.conteo.registrar'), ('bodeguero','inventarios.existencia.ver'),
    ('planificador_produccion','fabricacion.orden.liberar'), ('planificador_produccion','fabricacion.orden.programar'),
    ('planificador_produccion','fabricacion.orden.reportar'), ('planificador_produccion','inventarios.existencia.ver'),
    ('cajero','caja.sesion.abrir'), ('cajero','caja.sesion.cerrar'), ('cajero','caja.cobro.registrar'),
    ('cajero','caja.arqueo.realizar'), ('cajero','caja.movimiento.reversar'),
    ('contador','facturacion.factura.emitir'), ('contador','facturacion.factura.anular'),
    ('contador','facturacion.conciliacion.realizar'), ('contador','facturacion.cartera.ver'), ('contador','reportes.ver'),
    ('comprador','compras.proveedor.gestionar'), ('comprador','compras.orden.crear'),
    ('comprador','compras.orden.aprobar'), ('comprador','inventarios.existencia.ver')
  ) v(rol, permiso)
  JOIN seguridad.rol r ON r.codigo = v.rol
  JOIN seguridad.permiso p ON p.codigo = v.permiso
ON CONFLICT DO NOTHING;

-- El administrador gestiona usuarios, roles y catálogos (más todos los permisos de consulta)
INSERT INTO seguridad.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM seguridad.rol r CROSS JOIN seguridad.permiso p
 WHERE r.codigo = 'administrador'
ON CONFLICT DO NOTHING;
```

### 6.15 Ejecutar los scripts y verificar las reglas en la base de datos

```bash
# Local (Supabase)
for f in db/scripts/*.sql; do
  echo ">> $f"; psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "$f"
done
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f db/tests/reglas.sql
```

`db/tests/reglas.sql` comprueba que los guardianes de la base de datos funcionan (cada bloque espera un error y falla si no ocurre). Se ejecuta dentro de una transacción que se revierte:

```sql
-- db/tests/reglas.sql
BEGIN;
-- Datos mínimos
INSERT INTO inventarios.bodega (id, empresa_id, codigo, nombre)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'B1', 'Principal');

-- Utilidad: afirma que una sentencia falla con el SQLSTATE esperado
CREATE OR REPLACE FUNCTION pg_temp.espera_error(p_sql text, p_estado text, p_regla text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado THEN RETURN; END IF;
    RAISE EXCEPTION '% falló con SQLSTATE % (se esperaba %): %', p_regla, SQLSTATE, p_estado, SQLERRM;
  END;
  RAISE EXCEPTION '% NO se aplicó: la sentencia debía fallar', p_regla;
END; $$ LANGUAGE plpgsql;

-- R3 / R5: no se puede reservar ni sacar más de lo que hay (el kardex alimenta la existencia)
SELECT pg_temp.espera_error($q$
  INSERT INTO inventarios.kardex (empresa_id, articulo_id, bodega_id, tipo, delta_reservado)
  VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000b1','RESERVA', 5)$q$, '23514', 'R3');

-- R5: el kardex es inmutable
INSERT INTO inventarios.kardex (id, empresa_id, articulo_id, bodega_id, tipo, delta_fisico)
VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','AJUSTE_POSITIVO', 10);
SELECT pg_temp.espera_error($q$DELETE FROM inventarios.kardex$q$, 'P0001', 'R5');
SELECT 1 / (CASE WHEN count(*) = 0 THEN 1 ELSE 0 END) FROM inventarios.v_inconsistencias_kardex;  -- 0 inconsistencias

-- R8: dos sesiones abiertas para la misma caja
INSERT INTO caja.caja (id, empresa_id, codigo, nombre)
  VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','C1','Caja 1');
INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id)
  VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1', gen_random_uuid());
SELECT pg_temp.espera_error($q$
  INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id)
  VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1', gen_random_uuid())$q$,
  '23505', 'R8');

-- R10: no se acepta un número de tarjeta como referencia
SELECT pg_temp.espera_error($q$
  INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia, idempotency_key, usuario_id)
  SELECT gen_random_uuid(), empresa_id, id, 'COBRO', 'ENTRADA', 'TARJETA', 1000, '4111 1111 1111 1111', gen_random_uuid(), usuario_id
    FROM caja.sesion_caja LIMIT 1$q$, '23514', 'R10');

ROLLBACK;
```

---

## 7. Backend: NestJS con Clean Architecture

Se implementan de forma completa los módulos que concentran las reglas críticas: **Pedidos** (R1, R2, R13), **Inventarios** (R3, R5, R12), **Fabricación** (R1, R4), **Caja** (R8, R9, R10) y **Facturación** (R6, R7, R14), más los casos clave de **Despacho** (R12) y **Compras** (R11). Los demás módulos (Catálogo, Seguridad, resto de Compras y Despacho) se construyen **copiando exactamente el mismo patrón**.

```bash
cd apps/api
pnpm add pg jose zod uuid
pnpm add -D @types/pg
```

### 7.1 Kernel compartido (`src/kernel/`)

```ts
// src/kernel/resultado.ts
export type Resultado<T, E = string> = { ok: true; valor: T } | { ok: false; error: E };
export const ok = <T>(valor: T): Resultado<T, never> => ({ ok: true, valor });
export const fallo = <E = string>(error: E): Resultado<never, E> => ({ ok: false, error });

// src/kernel/errores.ts
export class ErrorNegocio extends Error {
  constructor(public readonly codigo: string, mensaje: string) { super(mensaje); }
}
```

```ts
// src/kernel/raiz-agregado.ts
export interface EventoDominio {
  readonly tipo: string;                 // 'pedidos.PedidoConfirmado'
  readonly agregadoId: string;
  readonly empresaId: string;
  readonly datos: Record<string, unknown>;
  readonly ocurrioEn: Date;
}

export abstract class RaizAgregado {
  private eventos: EventoDominio[] = [];
  protected registrar(evento: EventoDominio): void { this.eventos.push(evento); }
  extraerEventos(): EventoDominio[] { const e = this.eventos; this.eventos = []; return e; }
}
```

```ts
// src/kernel/dinero.ts   (Value Object)
export class Dinero {
  private constructor(private readonly centavos: number, readonly moneda: string) {}
  static de(valor: number, moneda = 'COP'): Dinero { return new Dinero(Math.round(valor * 100), moneda); }
  static cero(moneda = 'COP'): Dinero { return new Dinero(0, moneda); }
  sumar(o: Dinero): Dinero { this.mismaMoneda(o); return new Dinero(this.centavos + o.centavos, this.moneda); }
  multiplicar(factor: number): Dinero { return new Dinero(Math.round(this.centavos * factor), this.moneda); }
  get valor(): number { return this.centavos / 100; }
  private mismaMoneda(o: Dinero) { if (o.moneda !== this.moneda) throw new Error('Monedas distintas'); }
}
```

### 7.2 Infraestructura transversal (`src/infraestructura/`)

**Base de datos con transacción por contexto** (evita pasar el cliente `pg` por todas las capas):

```ts
// src/infraestructura/base-datos.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class BaseDatos {
  private readonly als = new AsyncLocalStorage<PoolClient>();
  constructor(private readonly pool: Pool) {}

  async consultar<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const cliente = this.als.getStore();
    const r = cliente ? await cliente.query(sql, params) : await this.pool.query(sql, params);
    return r.rows as T[];
  }

  /** Ejecuta fn dentro de una transacción. Si ya hay una activa, se reutiliza. */
  async transaccion<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn();
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await this.als.run(cliente, fn);
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw e;
    } finally {
      cliente.release();
    }
  }
}
```

**Publicador de eventos (Transactional Outbox) y bus interno:**

```ts
// src/infraestructura/eventos.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from './base-datos';
import { EventoDominio } from '../kernel/raiz-agregado';

export interface EventoOutbox { id: string; empresa_id: string; tipo: string; agregado_id: string; payload: any; }
type Manejador = (e: EventoOutbox) => Promise<void>;

@Injectable()
export class BusEventos {
  private manejadores = new Map<string, Manejador[]>();
  suscribir(tipo: string, m: Manejador) {
    this.manejadores.set(tipo, [...(this.manejadores.get(tipo) ?? []), m]);
  }
  async emitir(e: EventoOutbox) {
    for (const m of this.manejadores.get(e.tipo) ?? []) await m(e);
  }
}

@Injectable()
export class PublicadorEventos {
  constructor(private readonly bd: BaseDatos) {}
  /** Se llama DENTRO de la misma transacción que guarda el agregado. */
  async publicar(eventos: EventoDominio[]): Promise<void> {
    for (const e of eventos) {
      await this.bd.consultar(
        `INSERT INTO nucleo.evento_outbox (empresa_id, tipo, agregado_id, payload) VALUES ($1,$2,$3,$4)`,
        [e.empresaId, e.tipo, e.agregadoId, JSON.stringify(e.datos)],
      );
    }
  }
}

@Injectable()
export class DespachadorOutbox implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ocupado = false;
  constructor(private readonly bd: BaseDatos, private readonly bus: BusEventos) {}

  onModuleInit() { this.timer = setInterval(() => this.ciclo().catch(console.error), 1000); }
  onModuleDestroy() { clearInterval(this.timer); }

  private async ciclo() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      for (;;) {
        // Reclama lote (autocommit). Los manejadores deben ser idempotentes (entrega "al menos una vez").
        const lote = await this.bd.consultar<EventoOutbox>(
          `UPDATE nucleo.evento_outbox SET intentos = intentos + 1
            WHERE id IN (SELECT id FROM nucleo.evento_outbox
                          WHERE procesado_en IS NULL AND intentos < 10
                          ORDER BY creado_en LIMIT 20 FOR UPDATE SKIP LOCKED)
          RETURNING id, empresa_id, tipo, agregado_id, payload`);
        if (lote.length === 0) break;
        for (const e of lote) {
          try {
            await this.bus.emitir(e);
            await this.bd.consultar(`UPDATE nucleo.evento_outbox SET procesado_en = now() WHERE id = $1`, [e.id]);
          } catch (err) {
            console.error(`Evento ${e.tipo} (${e.id}) falló`, err);
          }
        }
      }
    } finally { this.ocupado = false; }
  }
}
```

### 7.3 Módulo Pedidos — capa de **Dominio** (R1, R2, R13)

```ts
// src/modulos/pedidos/dominio/cliente-credito.ts
import { Resultado, ok, fallo } from '../../../kernel/resultado';

/** Modelo de cliente del contexto Pedidos: solo lo necesario para decidir el crédito (R13). */
export class ClienteCredito {
  constructor(
    readonly id: string, readonly empresaId: string,
    readonly limiteCredito: number, private _creditoUsado: number, readonly bloqueado: boolean,
  ) {}
  get creditoUsado() { return this._creditoUsado; }
  get disponible() { return this.limiteCredito - this._creditoUsado; }

  /** R13: ¿el valor supera el crédito disponible? */
  excedeLimite(valor: number): boolean { return valor > this.disponible; }

  consumir(valor: number): Resultado<void> {
    if (this.bloqueado) return fallo('El cliente está bloqueado para crédito');
    this._creditoUsado += valor;
    return ok(undefined);
  }
  liberar(valor: number): void { this._creditoUsado = Math.max(0, this._creditoUsado - valor); }
}
```

```ts
// src/modulos/pedidos/dominio/pedido.ts
import { RaizAgregado } from '../../../kernel/raiz-agregado';
import { Dinero } from '../../../kernel/dinero';
import { Resultado, ok, fallo } from '../../../kernel/resultado';
import { ClienteCredito } from './cliente-credito';

export type EstadoPedido = 'BORRADOR' | 'PENDIENTE_APROBACION' | 'CONFIRMADO' | 'DESPACHADO' | 'CANCELADO' | 'RECHAZADO';
export type CondicionPago = 'CONTADO' | 'CREDITO';
export type Canal = 'MOSTRADOR' | 'WEB' | 'TELEFONO';
export type VeredictoCredito = 'OK' | 'REQUIERE_APROBACION' | 'BLOQUEADO';

export interface LineaPedido {
  id: string; articuloId: string; descripcion: string; cantidad: number;
  precioUnitario: Dinero; descuentoPct: number; ivaPct: number;
  cantidadReservada: number;      // R2: parte cubierta con stock
  cantidadAFabricar: number;      // R2: parte que genera Orden de Fabricación
}
export interface ReservaLinea { lineaId: string; reservada: number }

export interface PropsPedido {
  id: string; empresaId: string; clienteId: string; vendedorId: string; bodegaId: string;
  canal: Canal; condicionPago: CondicionPago; estado: EstadoPedido;
  numero: string | null; motivoRechazo: string | null; lineas: LineaPedido[]; version: number;
}
export type NuevoPedido = Omit<PropsPedido, 'estado' | 'numero' | 'motivoRechazo' | 'version' | 'lineas'> & {
  lineas: Omit<LineaPedido, 'cantidadReservada' | 'cantidadAFabricar'>[];
};

export class Pedido extends RaizAgregado {
  private constructor(private props: PropsPedido) { super(); }

  static crearBorrador(p: NuevoPedido): Resultado<Pedido> {
    if (p.lineas.some(l => l.cantidad <= 0)) return fallo('Las cantidades deben ser mayores a cero');
    const lineas = p.lineas.map(l => ({ ...l, cantidadReservada: 0, cantidadAFabricar: 0 }));
    return ok(new Pedido({ ...p, lineas, estado: 'BORRADOR', numero: null, motivoRechazo: null, version: 0 }));
  }
  static reconstituir(props: PropsPedido): Pedido { return new Pedido(props); }

  get id() { return this.props.id; }
  get empresaId() { return this.props.empresaId; }
  get estado() { return this.props.estado; }
  get numero() { return this.props.numero; }
  get lineas() { return [...this.props.lineas]; }
  get snapshot(): Readonly<PropsPedido> { return this.props; }

  subtotal(): Dinero {
    return this.props.lineas.reduce(
      (a, l) => a.sumar(l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100))), Dinero.cero());
  }
  impuestos(): Dinero {
    return this.props.lineas.reduce(
      (a, l) => a.sumar(l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100) * (l.ivaPct / 100))), Dinero.cero());
  }
  total(): Dinero { return this.subtotal().sumar(this.impuestos()); }

  reemplazarLineas(lineas: NuevoPedido['lineas']): Resultado<void> {
    if (this.props.estado !== 'BORRADOR') return fallo('Solo se puede editar un pedido en borrador');
    this.props.lineas = lineas.map(l => ({ ...l, cantidadReservada: 0, cantidadAFabricar: 0 }));
    return ok(undefined);
  }

  /** R13: decide si el pedido a crédito puede confirmarse, requiere al supervisor o está bloqueado. */
  evaluarCredito(cliente: ClienteCredito): VeredictoCredito {
    if (this.props.condicionPago !== 'CREDITO') return 'OK';
    if (cliente.bloqueado) return 'BLOQUEADO';
    return cliente.excedeLimite(this.total().valor) ? 'REQUIERE_APROBACION' : 'OK';
  }

  enviarAAprobacion(valorExcedido: number): Resultado<void> {
    if (this.props.estado !== 'BORRADOR') return fallo(`No se puede enviar a aprobación un pedido ${this.props.estado}`);
    this.props.estado = 'PENDIENTE_APROBACION';
    this.registrar({
      tipo: 'pedidos.PedidoRequiereAprobacion', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: { pedidoId: this.id, clienteId: this.props.clienteId, total: this.total().valor, valorExcedido },
    });
    return ok(undefined);
  }

  /**
   * R1 y R2: recibe lo que Inventarios pudo reservar por línea. Lo reservado queda en cantidadReservada
   * y el faltante en cantidadAFabricar. El evento lleva solo las líneas con faltante hacia Fabricación.
   */
  confirmar(numero: string, reservas: ReservaLinea[]): Resultado<void> {
    if (!['BORRADOR', 'PENDIENTE_APROBACION'].includes(this.props.estado))
      return fallo(`No se puede confirmar un pedido en estado ${this.props.estado}`);
    if (this.props.lineas.length === 0) return fallo('El pedido no tiene líneas');

    for (const l of this.props.lineas) {
      const reservada = reservas.find(r => r.lineaId === l.id)?.reservada ?? 0;
      l.cantidadReservada = Math.min(Math.max(reservada, 0), l.cantidad);
      l.cantidadAFabricar = l.cantidad - l.cantidadReservada;
    }
    this.props.estado = 'CONFIRMADO';
    this.props.numero = numero;
    this.registrar({
      tipo: 'pedidos.PedidoConfirmado', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: {
        pedidoId: this.id, numero, clienteId: this.props.clienteId, bodegaId: this.props.bodegaId,
        condicionPago: this.props.condicionPago, total: this.total().valor,
        lineas: this.props.lineas.map(l => ({
          pedidoLineaId: l.id, articuloId: l.articuloId, cantidad: l.cantidad,
          reservada: l.cantidadReservada, aFabricar: l.cantidadAFabricar,
        })),
      },
    });
    return ok(undefined);
  }

  rechazar(motivo: string): Resultado<void> {
    if (this.props.estado !== 'PENDIENTE_APROBACION') return fallo('Solo se rechaza un pedido pendiente de aprobación');
    this.props.estado = 'RECHAZADO';
    this.props.motivoRechazo = motivo;
    return ok(undefined);
  }

  cancelar(): Resultado<void> {
    if (['DESPACHADO', 'CANCELADO'].includes(this.props.estado)) return fallo('El pedido no se puede cancelar');
    this.props.estado = 'CANCELADO';
    this.registrar({
      tipo: 'pedidos.PedidoCancelado', agregadoId: this.id, empresaId: this.empresaId, ocurrioEn: new Date(),
      datos: { pedidoId: this.id, total: this.total().valor, condicionPago: this.props.condicionPago, clienteId: this.props.clienteId },
    });
    return ok(undefined);
  }
}

// ---- Puertos de repositorio (interfaces) ----
export const PEDIDO_REPOSITORIO = Symbol('PEDIDO_REPOSITORIO');
export interface PedidoRepositorio {
  obtener(id: string, empresaId: string): Promise<Pedido | null>;     // con bloqueo FOR UPDATE
  guardar(pedido: Pedido): Promise<void>;
  siguienteNumero(empresaId: string, serie: string): Promise<string>;
}

export const CLIENTE_CREDITO_REPOSITORIO = Symbol('CLIENTE_CREDITO_REPOSITORIO');
export interface ClienteCreditoRepositorio {
  obtener(id: string, empresaId: string): Promise<ClienteCredito | null>;   // con bloqueo FOR UPDATE
  guardar(c: ClienteCredito): Promise<void>;
}
```

### 7.4 Módulo Pedidos — capa de **Aplicación**

El orquestador no importa Inventarios: define un **puerto** y la infraestructura lo implementa.

```ts
// src/modulos/pedidos/aplicacion/puertos.ts
export const INVENTARIOS_PUERTO = Symbol('INVENTARIOS_PUERTO');
export interface InventariosPuerto {
  /** Reserva el MENOR entre lo pedido y lo disponible. Idempotente por pedidoLineaId. */
  reservar(c: { empresaId: string; articuloId: string; bodegaId: string; cantidad: number;
                pedidoId: string; pedidoLineaId: string; usuarioId: string }): Promise<{ reservada: number }>;
}
```

```ts
// src/modulos/pedidos/aplicacion/confirmar-pedido.ts
import { Inject, Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import {
  CLIENTE_CREDITO_REPOSITORIO, ClienteCreditoRepositorio, PEDIDO_REPOSITORIO, PedidoRepositorio,
} from '../dominio/pedido';
import { INVENTARIOS_PUERTO, InventariosPuerto } from './puertos';

export interface ConfirmarPedidoComando {
  empresaId: string; pedidoId: string; usuarioId: string;
  esAprobacion?: boolean;          // true cuando lo ejecuta el supervisor (salta el control R13)
}
export interface ResultadoConfirmacion { estado: 'CONFIRMADO' | 'PENDIENTE_APROBACION'; numero?: string }

@Injectable()
export class ConfirmarPedido {
  constructor(
    @Inject(PEDIDO_REPOSITORIO) private readonly pedidos: PedidoRepositorio,
    @Inject(CLIENTE_CREDITO_REPOSITORIO) private readonly clientes: ClienteCreditoRepositorio,
    @Inject(INVENTARIOS_PUERTO) private readonly inventarios: InventariosPuerto,
    private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos,
  ) {}

  async ejecutar(cmd: ConfirmarPedidoComando): Promise<ResultadoConfirmacion> {
    return this.bd.transaccion(async () => {
      const pedido = await this.pedidos.obtener(cmd.pedidoId, cmd.empresaId);
      if (!pedido) throw new ErrorNegocio('PEDIDO_NO_EXISTE', 'El pedido no existe');

      // Idempotencia natural: un pedido ya confirmado devuelve el mismo resultado
      if (pedido.estado === 'CONFIRMADO' && pedido.numero) return { estado: 'CONFIRMADO', numero: pedido.numero };
      if (cmd.esAprobacion && pedido.estado !== 'PENDIENTE_APROBACION')
        throw new ErrorNegocio('PEDIDO_NO_PENDIENTE', 'El pedido no está pendiente de aprobación');

      const cliente = await this.clientes.obtener(pedido.snapshot.clienteId, cmd.empresaId);
      if (!cliente) throw new ErrorNegocio('CLIENTE_NO_EXISTE', 'El cliente no existe en Pedidos');

      // ---- R13: control de crédito ----
      const veredicto = pedido.evaluarCredito(cliente);
      if (veredicto === 'BLOQUEADO') throw new ErrorNegocio('CLIENTE_BLOQUEADO', 'El cliente está bloqueado para crédito');
      if (veredicto === 'REQUIERE_APROBACION' && !cmd.esAprobacion) {
        const excedido = pedido.total().valor - cliente.disponible;
        const r = pedido.enviarAAprobacion(excedido);
        if (!r.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', r.error);
        await this.pedidos.guardar(pedido);
        await this.eventos.publicar(pedido.extraerEventos());
        return { estado: 'PENDIENTE_APROBACION' };      // no es un error: el supervisor debe decidir
      }

      // ---- R2 y R3: reservar por línea lo que haya disponible (misma transacción, FOR UPDATE) ----
      const reservas = [];
      for (const l of pedido.lineas) {
        const r = await this.inventarios.reservar({
          empresaId: cmd.empresaId, articuloId: l.articuloId, bodegaId: pedido.snapshot.bodegaId,
          cantidad: l.cantidad, pedidoId: pedido.id, pedidoLineaId: l.id, usuarioId: cmd.usuarioId,
        });
        reservas.push({ lineaId: l.id, reservada: r.reservada });
      }

      // ---- R1: el dominio calcula el faltante y emite el evento hacia Fabricación ----
      const numero = await this.pedidos.siguienteNumero(cmd.empresaId, 'PED');
      const c = pedido.confirmar(numero, reservas);
      if (!c.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', c.error);

      if (pedido.snapshot.condicionPago === 'CREDITO') {
        const consumo = cliente.consumir(pedido.total().valor);
        if (!consumo.ok) throw new ErrorNegocio('CLIENTE_BLOQUEADO', consumo.error);
        await this.clientes.guardar(cliente);
      }
      await this.pedidos.guardar(pedido);
      await this.eventos.publicar(pedido.extraerEventos());    // misma transacción => outbox
      return { estado: 'CONFIRMADO', numero };
    });
  }
}

// src/modulos/pedidos/aplicacion/aprobar-pedido.ts
@Injectable()
export class AprobarPedido {
  constructor(private readonly confirmar: ConfirmarPedido) {}
  ejecutar(cmd: Omit<ConfirmarPedidoComando, 'esAprobacion'>) {
    return this.confirmar.ejecutar({ ...cmd, esAprobacion: true });
  }
}
```

```ts
// src/modulos/pedidos/aplicacion/guardar-borrador-pedido.ts
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Dinero } from '../../../kernel/dinero';
import { ErrorNegocio } from '../../../kernel/errores';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Pedido, PEDIDO_REPOSITORIO, PedidoRepositorio } from '../dominio/pedido';

export const BorradorPedidoSchema = z.object({
  id: z.string().uuid(),
  clienteId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  canal: z.enum(['MOSTRADOR', 'WEB', 'TELEFONO']).default('MOSTRADOR'),
  condicionPago: z.enum(['CONTADO', 'CREDITO']).default('CONTADO'),
  lineas: z.array(z.object({
    id: z.string().uuid(), articuloId: z.string().uuid(), descripcion: z.string(),
    cantidad: z.number().positive(), precioUnitario: z.number().nonnegative(),
    descuentoPct: z.number().min(0).max(100).default(0), ivaPct: z.number().min(0).max(100).default(0),
  })).min(1),
});

@Injectable()
export class GuardarBorradorPedido {
  constructor(@Inject(PEDIDO_REPOSITORIO) private readonly repo: PedidoRepositorio, private readonly bd: BaseDatos) {}

  async ejecutar(empresaId: string, vendedorId: string, entrada: unknown): Promise<void> {
    const d = BorradorPedidoSchema.parse(entrada);
    // OJO: el precio llega del cliente (copia local). En un sistema real se revalida contra catalogo.articulo
    // mediante un puerto antes de confirmar (el servidor es la fuente de verdad de precios e impuestos).
    const lineas = d.lineas.map(l => ({ ...l, precioUnitario: Dinero.de(l.precioUnitario) }));
    await this.bd.transaccion(async () => {
      const existente = await this.repo.obtener(d.id, empresaId);
      if (existente) {
        const r = existente.reemplazarLineas(lineas);
        if (!r.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', r.error);
        return this.repo.guardar(existente);
      }
      const nuevo = Pedido.crearBorrador({
        id: d.id, empresaId, clienteId: d.clienteId, vendedorId, bodegaId: d.bodegaId,
        canal: d.canal, condicionPago: d.condicionPago, lineas,
      });
      if (!nuevo.ok) throw new ErrorNegocio('PEDIDO_INVALIDO', nuevo.error);
      await this.repo.guardar(nuevo.valor);
    });
  }
}
```

### 7.5 Módulo Pedidos — capa de **Infraestructura**

```ts
// src/modulos/pedidos/infraestructura/pedido.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { Dinero } from '../../../kernel/dinero';
import { Pedido, PedidoRepositorio } from '../dominio/pedido';

const estadoAbastecimiento = (cant: number, res: number, fab: number) =>
  res >= cant ? 'RESERVADO' : res > 0 && fab > 0 ? 'MIXTO' : fab > 0 ? 'EN_FABRICACION' : 'PENDIENTE';

@Injectable()
export class PedidoRepositorioPg implements PedidoRepositorio {
  constructor(private readonly bd: BaseDatos) {}

  async obtener(id: string, empresaId: string): Promise<Pedido | null> {
    const [p] = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido WHERE id = $1 AND empresa_id = $2 AND eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    if (!p) return null;
    const lineas = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido_linea WHERE pedido_id = $1 AND eliminado_en IS NULL ORDER BY creado_en, id`, [id]);
    return Pedido.reconstituir({
      id: p.id, empresaId: p.empresa_id, clienteId: p.cliente_id, vendedorId: p.vendedor_id, bodegaId: p.bodega_id,
      canal: p.canal, condicionPago: p.condicion_pago, estado: p.estado, numero: p.numero,
      motivoRechazo: p.motivo_rechazo, version: p.version,
      lineas: lineas.map((l: any) => ({
        id: l.id, articuloId: l.articulo_id, descripcion: l.descripcion, cantidad: Number(l.cantidad),
        precioUnitario: Dinero.de(Number(l.precio_unitario)), descuentoPct: Number(l.descuento_pct), ivaPct: Number(l.iva_pct),
        cantidadReservada: Number(l.cantidad_reservada), cantidadAFabricar: Number(l.cantidad_a_fabricar),
      })),
    });
  }

  async guardar(pedido: Pedido): Promise<void> {
    const s = pedido.snapshot;
    await this.bd.consultar(
      `INSERT INTO pedidos.pedido (id, empresa_id, numero, cliente_id, vendedor_id, bodega_id, canal, condicion_pago,
                                   estado, motivo_rechazo, subtotal, impuestos, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET numero=$3, estado=$9, motivo_rechazo=$10, subtotal=$11, impuestos=$12, total=$13`,
      [s.id, s.empresaId, s.numero, s.clienteId, s.vendedorId, s.bodegaId, s.canal, s.condicionPago,
       s.estado, s.motivoRechazo, pedido.subtotal().valor, pedido.impuestos().valor, pedido.total().valor]);

    // Borrado lógico de líneas retiradas (para que los dispositivos se enteren)
    await this.bd.consultar(
      `UPDATE pedidos.pedido_linea SET eliminado_en = now() WHERE pedido_id = $1 AND eliminado_en IS NULL AND id <> ALL($2::uuid[])`,
      [s.id, s.lineas.map(l => l.id)]);

    for (const l of s.lineas) {
      const totalLinea = l.precioUnitario.multiplicar(l.cantidad * (1 - l.descuentoPct / 100)).valor;
      await this.bd.consultar(
        `INSERT INTO pedidos.pedido_linea (id, empresa_id, pedido_id, articulo_id, descripcion, cantidad, precio_unitario,
                                           descuento_pct, iva_pct, total_linea, cantidad_reservada, cantidad_a_fabricar, estado_abastecimiento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET cantidad=$6, precio_unitario=$7, descuento_pct=$8, iva_pct=$9, total_linea=$10,
           descripcion=$5, cantidad_reservada=$11, cantidad_a_fabricar=$12, estado_abastecimiento=$13, eliminado_en=NULL`,
        [l.id, s.empresaId, s.id, l.articuloId, l.descripcion, l.cantidad, l.precioUnitario.valor, l.descuentoPct,
         l.ivaPct, totalLinea, l.cantidadReservada, l.cantidadAFabricar,
         estadoAbastecimiento(l.cantidad, l.cantidadReservada, l.cantidadAFabricar)]);
    }
  }

  async siguienteNumero(empresaId: string, serie: string): Promise<string> {
    const [r] = await this.bd.consultar(
      `INSERT INTO pedidos.consecutivo (empresa_id, serie, ultimo) VALUES ($1,$2,1)
       ON CONFLICT (empresa_id, serie) DO UPDATE SET ultimo = pedidos.consecutivo.ultimo + 1
       RETURNING ultimo`, [empresaId, serie]);
    return `${serie}-${String(r.ultimo).padStart(8, '0')}`;
  }
}
```

```ts
// src/modulos/pedidos/infraestructura/cliente-credito.repositorio.pg.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { ClienteCredito } from '../dominio/cliente-credito';
import { ClienteCreditoRepositorio } from '../dominio/pedido';

@Injectable()
export class ClienteCreditoRepositorioPg implements ClienteCreditoRepositorio {
  constructor(private readonly bd: BaseDatos) {}
  async obtener(id: string, empresaId: string) {
    // FOR UPDATE: dos pedidos del mismo cliente no pueden consumir el mismo crédito a la vez (R13)
    const [c] = await this.bd.consultar(
      `SELECT * FROM pedidos.cliente WHERE id=$1 AND empresa_id=$2 AND eliminado_en IS NULL FOR UPDATE`, [id, empresaId]);
    return c ? new ClienteCredito(c.id, c.empresa_id, Number(c.limite_credito), Number(c.credito_usado), c.bloqueado) : null;
  }
  async guardar(c: ClienteCredito) {
    await this.bd.consultar(`UPDATE pedidos.cliente SET credito_usado=$2 WHERE id=$1`, [c.id, c.creditoUsado]);
  }
}
```

```ts
// src/modulos/pedidos/infraestructura/inventarios.adaptador.ts   (anti-corrupción hacia el otro módulo)
import { Injectable } from '@nestjs/common';
import { InventariosApi } from '../../inventarios';            // solo la API pública (index.ts)
import { InventariosPuerto } from '../aplicacion/puertos';

@Injectable()
export class InventariosAdaptador implements InventariosPuerto {
  constructor(private readonly api: InventariosApi) {}
  async reservar(c: Parameters<InventariosPuerto['reservar']>[0]) {
    const r = await this.api.reservar({ ...c, origen: 'inicial' });
    return { reservada: r.reservada };
  }
}
```

### 7.6 Módulo Pedidos — **Presentación** y módulo Nest

```ts
// src/modulos/pedidos/presentacion/pedidos.controller.ts
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Permiso } from '../../../infraestructura/auth';
import { ConfirmarPedido } from '../aplicacion/confirmar-pedido';
import { AprobarPedido } from '../aplicacion/aprobar-pedido';
import { GuardarBorradorPedido } from '../aplicacion/guardar-borrador-pedido';

@Controller('pedidos')
@UseGuards(AuthGuard)
export class PedidosController {
  constructor(
    private readonly confirmar: ConfirmarPedido,
    private readonly aprobar: AprobarPedido,
    private readonly guardar: GuardarBorradorPedido,
  ) {}

  @Post()
  @Permiso('pedidos.pedido.crear')
  async crear(@Req() req: any, @Body() body: unknown) {
    await this.guardar.ejecutar(req.usuario.empresaId, req.usuario.id, body);
    return { ok: true };
  }

  @Post(':id/confirmar')
  @Permiso('pedidos.pedido.confirmar')
  confirmarPedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.confirmar.ejecutar({ empresaId: req.usuario.empresaId, pedidoId: id, usuarioId: req.usuario.id });
  }

  @Post(':id/aprobar')                       // Supervisor de ventas (R13)
  @Permiso('pedidos.pedido.aprobar')
  aprobarPedido(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.aprobar.ejecutar({ empresaId: req.usuario.empresaId, pedidoId: id, usuarioId: req.usuario.id });
  }
}
```

```ts
// src/modulos/pedidos/index.ts   (API pública del módulo, usada por Facturación)
export { PedidosApi } from './pedidos.api';

// src/modulos/pedidos/pedidos.api.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';

export interface PedidoFacturable {
  pedidoId: string; clienteId: string; condicionPago: 'CONTADO' | 'CREDITO';
  subtotal: number; impuestos: number; total: number;
  lineas: { articuloId: string; descripcion: string; cantidad: number; precioUnitario: number; ivaPct: number; totalLinea: number }[];
}

@Injectable()
export class PedidosApi {
  constructor(private readonly bd: BaseDatos) {}
  async obtenerParaFacturar(empresaId: string, pedidoId: string): Promise<PedidoFacturable | null> {
    const [p] = await this.bd.consultar(
      `SELECT * FROM pedidos.pedido WHERE id=$1 AND empresa_id=$2 AND estado IN ('CONFIRMADO','DESPACHADO')`, [pedidoId, empresaId]);
    if (!p) return null;
    const ls = await this.bd.consultar(`SELECT * FROM pedidos.pedido_linea WHERE pedido_id=$1 AND eliminado_en IS NULL`, [pedidoId]);
    return {
      pedidoId, clienteId: p.cliente_id, condicionPago: p.condicion_pago,
      subtotal: Number(p.subtotal), impuestos: Number(p.impuestos), total: Number(p.total),
      lineas: ls.map((l: any) => ({ articuloId: l.articulo_id, descripcion: l.descripcion, cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario), ivaPct: Number(l.iva_pct), totalLinea: Number(l.total_linea) })),
    };
  }
}
```

```ts
// src/modulos/pedidos/pedidos.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos } from '../../infraestructura/eventos';
import { InventariosModule } from '../inventarios/inventarios.module';
import { RegistroComandosSync } from '../sincronizacion';
import { CLIENTE_CREDITO_REPOSITORIO, PEDIDO_REPOSITORIO } from './dominio/pedido';
import { PedidoRepositorioPg } from './infraestructura/pedido.repositorio.pg';
import { ClienteCreditoRepositorioPg } from './infraestructura/cliente-credito.repositorio.pg';
import { InventariosAdaptador } from './infraestructura/inventarios.adaptador';
import { INVENTARIOS_PUERTO } from './aplicacion/puertos';
import { ConfirmarPedido } from './aplicacion/confirmar-pedido';
import { AprobarPedido } from './aplicacion/aprobar-pedido';
import { GuardarBorradorPedido } from './aplicacion/guardar-borrador-pedido';
import { PedidosController } from './presentacion/pedidos.controller';
import { PedidosApi } from './pedidos.api';

@Module({
  imports: [InventariosModule],
  controllers: [PedidosController],
  providers: [
    { provide: PEDIDO_REPOSITORIO, useClass: PedidoRepositorioPg },
    { provide: CLIENTE_CREDITO_REPOSITORIO, useClass: ClienteCreditoRepositorioPg },
    { provide: INVENTARIOS_PUERTO, useClass: InventariosAdaptador },
    ConfirmarPedido, AprobarPedido, GuardarBorradorPedido, PedidosApi,
  ],
  exports: [PedidosApi],
})
export class PedidosModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos, private readonly sync: RegistroComandosSync,
    private readonly guardar: GuardarBorradorPedido, private readonly confirmar: ConfirmarPedido,
  ) {}

  onModuleInit() {
    // 1) Comandos que llegan desde los dispositivos offline
    this.sync.registrar('pedidos.pedido.guardar_borrador', async (u, datos) => {
      await this.guardar.ejecutar(u.empresaId, u.id, datos); return {};
    });
    this.sync.registrar('pedidos.pedido.confirmar', (u, datos: any) =>
      this.confirmar.ejecutar({ empresaId: u.empresaId, pedidoId: datos.pedidoId, usuarioId: u.id }));

    // 2) Mantener el modelo de cliente de Pedidos a partir del catálogo (el límite de crédito lo fija el supervisor/admin)
    const upsertCliente = async (e: any) => {
      await this.bd.consultar(
        `INSERT INTO pedidos.cliente (id, empresa_id, numero_documento, razon_social)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET numero_documento=$3, razon_social=$4`,
        [e.payload.clienteId, e.empresa_id, e.payload.numeroDocumento, e.payload.razonSocial]);
    };
    this.bus.suscribir('catalogo.ClienteCreado', upsertCliente);
    this.bus.suscribir('catalogo.ClienteActualizado', upsertCliente);

    // 3) Producción terminada: Inventarios informa el total reservado de la línea (valor absoluto => idempotente)
    this.bus.suscribir('inventarios.StockReservadoPorProduccion', async (e) => {
      const { pedidoLineaId, reservadaTotal } = e.payload;
      await this.bd.consultar(
        `UPDATE pedidos.pedido_linea
            SET cantidad_reservada = LEAST(cantidad, $2),
                cantidad_a_fabricar = GREATEST(cantidad - LEAST(cantidad, $2), 0),
                estado_abastecimiento = CASE WHEN $2 >= cantidad THEN 'RESERVADO' ELSE 'MIXTO' END
          WHERE id = $1 AND empresa_id = $3`, [pedidoLineaId, reservadaTotal, e.empresa_id]);
    });

    // 4) Despacho completo => pedido DESPACHADO
    this.bus.suscribir('despacho.DespachoRealizado', async (e) => {
      if (!e.payload.completo) return;
      await this.bd.consultar(
        `UPDATE pedidos.pedido SET estado='DESPACHADO' WHERE id=$1 AND empresa_id=$2 AND estado='CONFIRMADO'`,
        [e.payload.pedidoId, e.empresa_id]);
    });
  }
}
```

**Canal e-commerce (cliente web).** Se agrega al módulo Pedidos un controller `/tienda` que **no** usa sincronización:

| Endpoint | Permiso | Comportamiento |
|---|---|---|
| `GET /tienda/catalogo` | `tienda.catalogo.ver` | Artículos `publicado_web = true` (cacheable) |
| `POST /tienda/checkout` | `tienda.checkout.crear` | Crea el pedido con `canal = 'WEB'`, `condicionPago = 'CONTADO'`. El `clienteId` se toma de `req.usuario.clienteId` (nunca del cuerpo). El pago lo tokeniza la pasarela externa (R10) |
| `GET /tienda/pedidos/:id` | `tienda.pedido.seguimiento` | Solo si `pedido.cliente_id = req.usuario.clienteId` |

### 7.7 Módulo Inventarios — API pública, reservas y kardex (R3, R5, R12)

```ts
// src/modulos/inventarios/index.ts   (API pública)
export { InventariosApi } from './inventarios.api';
export { InventariosModule } from './inventarios.module';
```

```ts
// src/modulos/inventarios/inventarios.api.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { ErrorNegocio } from '../../kernel/errores';

export type TipoKardex = 'ENTRADA_COMPRA' | 'ENTRADA_PRODUCCION' | 'SALIDA_DESPACHO'
                       | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO' | 'RESERVA' | 'LIBERACION';

@Injectable()
export class InventariosApi {
  constructor(private readonly bd: BaseDatos) {}

  /** R5: ÚNICA vía para cambiar existencias. Un trigger aplica el asiento a inventarios.existencia. */
  async asentarKardex(a: {
    empresaId: string; articuloId: string; bodegaId: string; tipo: TipoKardex;
    deltaFisico?: number; deltaReservado?: number; costoUnitario?: number;
    referenciaTipo: string; referenciaId: string; idempotencia: string; usuarioId?: string;
  }): Promise<boolean> {
    const r = await this.bd.consultar(
      `INSERT INTO inventarios.kardex (empresa_id, articulo_id, bodega_id, tipo, delta_fisico, delta_reservado,
                                       costo_unitario, referencia_tipo, referencia_id, idempotencia, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (empresa_id, idempotencia) DO NOTHING RETURNING id`,
      [a.empresaId, a.articuloId, a.bodegaId, a.tipo, a.deltaFisico ?? 0, a.deltaReservado ?? 0,
       a.costoUnitario ?? null, a.referenciaTipo, a.referenciaId, a.idempotencia, a.usuarioId ?? null]);
    return r.length > 0;                      // false => asiento ya existía (reintento)
  }

  /** R2 y R3: reserva el MENOR entre lo pedido y lo disponible. Idempotente por clave. */
  async reservar(c: {
    empresaId: string; articuloId: string; bodegaId: string; cantidad: number;
    pedidoId: string; pedidoLineaId: string; usuarioId?: string; origen: string;
  }): Promise<{ reservaId: string | null; reservada: number }> {
    return this.bd.transaccion(async () => {
      const clave = `pedido_linea:${c.pedidoLineaId}:${c.origen}`;
      const [previa] = await this.bd.consultar(
        `SELECT id, cantidad FROM inventarios.reserva_stock WHERE empresa_id=$1 AND clave_idempotencia=$2`, [c.empresaId, clave]);
      if (previa) return { reservaId: previa.id, reservada: Number(previa.cantidad) };

      // FOR UPDATE: serializa reservas concurrentes del mismo artículo/bodega (R3)
      const [ex] = await this.bd.consultar(
        `SELECT cantidad_disponible FROM inventarios.existencia
          WHERE empresa_id=$1 AND articulo_id=$2 AND bodega_id=$3 FOR UPDATE`, [c.empresaId, c.articuloId, c.bodegaId]);
      const reservada = Math.min(c.cantidad, Math.max(Number(ex?.cantidad_disponible ?? 0), 0));
      if (reservada <= 0) return { reservaId: null, reservada: 0 };

      const [r] = await this.bd.consultar(
        `INSERT INTO inventarios.reserva_stock (empresa_id, articulo_id, bodega_id, pedido_id, pedido_linea_id, cantidad, clave_idempotencia)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [c.empresaId, c.articuloId, c.bodegaId, c.pedidoId, c.pedidoLineaId, reservada, clave]);
      await this.asentarKardex({
        empresaId: c.empresaId, articuloId: c.articuloId, bodegaId: c.bodegaId, tipo: 'RESERVA', deltaReservado: reservada,
        referenciaTipo: 'pedidos.pedido', referenciaId: c.pedidoId, idempotencia: `reserva:${r.id}`, usuarioId: c.usuarioId,
      });
      return { reservaId: r.id, reservada };
    });
  }

  /** Reservas activas de un pedido (las usa Despacho). */
  reservasActivas(empresaId: string, pedidoId: string) {
    return this.bd.consultar<{ id: string; pedido_linea_id: string; articulo_id: string; cantidad: string }>(
      `SELECT id, pedido_linea_id, articulo_id, cantidad FROM inventarios.reserva_stock
        WHERE empresa_id=$1 AND pedido_id=$2 AND estado='ACTIVA'`, [empresaId, pedidoId]);
  }

  /** R12: solo se puede despachar consumiendo reservas ACTIVAS. Si alguna no lo está, falla toda la operación. */
  async consumirReservas(c: { empresaId: string; reservaIds: string[]; despachoId: string; usuarioId?: string }) {
    const consumidas = await this.bd.consultar(
      `UPDATE inventarios.reserva_stock SET estado='CONSUMIDA', referencia_despacho=$3, actualizado_en=now()
        WHERE empresa_id=$1 AND id = ANY($2::uuid[]) AND estado='ACTIVA'
        RETURNING id, articulo_id, bodega_id, cantidad`, [c.empresaId, c.reservaIds, c.despachoId]);
    if (c.reservaIds.length === 0 || consumidas.length !== c.reservaIds.length)
      throw new ErrorNegocio('R12_SIN_RESERVA_ACTIVA', 'No se puede despachar mercadería sin una reserva de stock activa');

    for (const r of consumidas) {
      await this.asentarKardex({
        empresaId: c.empresaId, articuloId: r.articulo_id, bodegaId: r.bodega_id, tipo: 'SALIDA_DESPACHO',
        deltaFisico: -Number(r.cantidad), deltaReservado: -Number(r.cantidad),
        referenciaTipo: 'despacho.despacho', referenciaId: c.despachoId, idempotencia: `salida:${r.id}`, usuarioId: c.usuarioId,
      });
    }
  }

  /** Libera las reservas ACTIVAS de un pedido (cancelación). */
  async liberarPorPedido(empresaId: string, pedidoId: string) {
    const liberadas = await this.bd.consultar(
      `UPDATE inventarios.reserva_stock SET estado='LIBERADA', actualizado_en=now()
        WHERE empresa_id=$1 AND pedido_id=$2 AND estado='ACTIVA' RETURNING id, articulo_id, bodega_id, cantidad`,
      [empresaId, pedidoId]);
    for (const r of liberadas) {
      await this.asentarKardex({
        empresaId, articuloId: r.articulo_id, bodegaId: r.bodega_id, tipo: 'LIBERACION', deltaReservado: -Number(r.cantidad),
        referenciaTipo: 'pedidos.pedido', referenciaId: pedidoId, idempotencia: `liberacion:${r.id}`,
      });
    }
  }
}
```

```ts
// src/modulos/inventarios/inventarios.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos, PublicadorEventos } from '../../infraestructura/eventos';
import { InventariosApi } from './inventarios.api';

@Module({ providers: [InventariosApi], exports: [InventariosApi] })
export class InventariosModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos,
    private readonly api: InventariosApi, private readonly eventos: PublicadorEventos,
  ) {}

  onModuleInit() {
    // Cancelación de pedido => se liberan las reservas
    this.bus.suscribir('pedidos.PedidoCancelado', (e) => this.api.liberarPorPedido(e.empresa_id, e.payload.pedidoId));

    // Compras: entrada al kardex por cada línea recibida (idempotente por línea de recepción)
    this.bus.suscribir('compras.RecepcionRegistrada', async (e) => {
      await this.bd.transaccion(async () => {
        for (const l of e.payload.lineas) {
          await this.api.asentarKardex({
            empresaId: e.empresa_id, articuloId: l.articuloId, bodegaId: e.payload.bodegaId, tipo: 'ENTRADA_COMPRA',
            deltaFisico: l.cantidad, costoUnitario: l.costoUnitario,
            referenciaTipo: 'compras.recepcion', referenciaId: e.payload.recepcionId, idempotencia: `recepcion-linea:${l.recepcionLineaId}`,
          });
        }
      });
    });

    // Fabricación: entra producto terminado y se reserva para la línea del pedido que originó la OF
    this.bus.suscribir('fabricacion.OrdenFabricacionTerminada', async (e) => {
      const o = e.payload;                       // { ordenId, articuloId, bodegaId, cantidad, pedidoId?, pedidoLineaId? }
      await this.bd.transaccion(async () => {
        await this.api.asentarKardex({
          empresaId: e.empresa_id, articuloId: o.articuloId, bodegaId: o.bodegaId, tipo: 'ENTRADA_PRODUCCION',
          deltaFisico: o.cantidad, referenciaTipo: 'fabricacion.orden', referenciaId: o.ordenId, idempotencia: `of:${o.ordenId}:entrada`,
        });
        if (!o.pedidoLineaId) return;
        await this.api.reservar({
          empresaId: e.empresa_id, articuloId: o.articuloId, bodegaId: o.bodegaId, cantidad: o.cantidad,
          pedidoId: o.pedidoId, pedidoLineaId: o.pedidoLineaId, origen: `of-${o.ordenId}`,
        });
        const [t] = await this.bd.consultar(
          `SELECT COALESCE(sum(cantidad),0) AS total FROM inventarios.reserva_stock
            WHERE pedido_linea_id=$1 AND estado IN ('ACTIVA','CONSUMIDA')`, [o.pedidoLineaId]);
        await this.eventos.publicar([{
          tipo: 'inventarios.StockReservadoPorProduccion', agregadoId: o.pedidoLineaId, empresaId: e.empresa_id, ocurrioEn: new Date(),
          datos: { pedidoLineaId: o.pedidoLineaId, reservadaTotal: Number(t.total) },
        }]);
      });
    });
  }
}
```

### 7.8 Módulo Fabricación (R1, R4)

```ts
// src/modulos/fabricacion/fabricacion.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { BaseDatos } from '../../infraestructura/base-datos';
import { BusEventos, PublicadorEventos } from '../../infraestructura/eventos';
import { RegistroComandosSync } from '../sincronizacion';
import { ErrorNegocio } from '../../kernel/errores';

@Module({})
export class FabricacionModule implements OnModuleInit {
  constructor(
    private readonly bus: BusEventos, private readonly bd: BaseDatos,
    private readonly eventos: PublicadorEventos, private readonly sync: RegistroComandosSync,
  ) {}

  onModuleInit() {
    // R1 + R4: por cada línea con faltante se crea UNA OF. La clave única hace seguro el reintento del evento.
    this.bus.suscribir('pedidos.PedidoConfirmado', async (e) => {
      const { pedidoId, bodegaId, lineas } = e.payload;
      await this.bd.transaccion(async () => {
        for (const l of lineas.filter((x: any) => x.aFabricar > 0)) {
          await this.bd.consultar(
            `INSERT INTO fabricacion.orden_fabricacion
               (id, empresa_id, numero, articulo_id, cantidad, estado, pedido_id, pedido_linea_id, clave_origen, bodega_destino_id)
             VALUES (gen_random_uuid(), $1, 'OF-' || lpad(nextval('fabricacion.seq_orden_fabricacion')::text, 8, '0'),
                     $2, $3, 'PLANIFICADA', $4, $5, $6, $7)
             ON CONFLICT ON CONSTRAINT uq_r4_clave_origen DO NOTHING`,
            [e.empresa_id, l.articuloId, l.aFabricar, pedidoId, l.pedidoLineaId, `pedido_linea:${l.pedidoLineaId}`, bodegaId]);
        }
      });
    });

    // Planificador: liberar OF
    this.sync.registrar('fabricacion.orden.liberar', async (u, d: { ordenId: string }) => {
      const r = await this.bd.consultar(
        `UPDATE fabricacion.orden_fabricacion SET estado='LIBERADA', liberada_por=$3, liberada_en=now()
          WHERE id=$1 AND empresa_id=$2 AND estado='PLANIFICADA' RETURNING id`, [d.ordenId, u.empresaId, u.id]);
      if (r.length === 0) throw new ErrorNegocio('OF_NO_LIBERABLE', 'La OF no existe o no está planificada');
      return {};
    });

    // Planificador: reportar cantidades producidas (idempotente por idempotencyKey)
    this.sync.registrar('fabricacion.orden.reportar', async (u, d: { ordenId: string; cantidad: number }, clave) => {
      const nuevo = await this.bd.consultar(
        `INSERT INTO fabricacion.reporte_produccion (empresa_id, orden_id, cantidad, reportado_por, idempotency_key)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [u.empresaId, d.ordenId, d.cantidad, u.id, clave]);
      if (nuevo.length === 0) return {};
      const [o] = await this.bd.consultar(
        `UPDATE fabricacion.orden_fabricacion
            SET cantidad_producida = cantidad_producida + $3,
                estado = CASE WHEN cantidad_producida + $3 >= cantidad THEN 'TERMINADA' ELSE 'EN_PROCESO' END
          WHERE id=$1 AND empresa_id=$2 AND estado IN ('LIBERADA','EN_PROCESO')
          RETURNING id, estado, articulo_id, cantidad_producida, pedido_id, pedido_linea_id, bodega_destino_id`,
        [d.ordenId, u.empresaId, d.cantidad]);
      if (!o) throw new ErrorNegocio('OF_NO_REPORTABLE', 'La OF no está liberada o en proceso');
      if (o.estado === 'TERMINADA') {
        await this.eventos.publicar([{
          tipo: 'fabricacion.OrdenFabricacionTerminada', agregadoId: o.id, empresaId: u.empresaId, ocurrioEn: new Date(),
          datos: { ordenId: o.id, articuloId: o.articulo_id, bodegaId: o.bodega_destino_id, cantidad: Number(o.cantidad_producida),
                   pedidoId: o.pedido_id, pedidoLineaId: o.pedido_linea_id },
        }]);
      }
      return {};
    });
  }
}
```

### 7.9 Módulo Caja (R8, R9, R10)

```ts
// src/modulos/caja/dominio/referencia-pago.ts   (Value Object - R10)
import { Resultado, ok, fallo } from '../../../kernel/resultado';

export type MedioPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'CHEQUE';

function luhn(digitos: string): boolean {
  let suma = 0, doble = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i]);
    if (doble) { n *= 2; if (n > 9) n -= 9; }
    suma += n; doble = !doble;
  }
  return suma % 10 === 0;
}

export class ReferenciaPago {
  private constructor(readonly valor: string | null) {}

  /** R10: solo se acepta token o código de autorización; jamás un número de tarjeta. */
  static crear(medio: MedioPago, texto?: string | null): Resultado<ReferenciaPago> {
    const t = (texto ?? '').trim();
    if (medio === 'TARJETA' && t.length < 6) return fallo('Un pago con tarjeta exige token o código de autorización');
    const soloDigitos = t.replace(/[ -]/g, '');
    if (/^\d{13,19}$/.test(soloDigitos) && luhn(soloDigitos))
      return fallo('La referencia parece un número de tarjeta. No se almacenan datos de tarjeta (use el token de la pasarela)');
    return ok(new ReferenciaPago(t || null));
  }
}
```

```ts
// src/modulos/caja/aplicacion/caja.casos-uso.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { ReferenciaPago } from '../dominio/referencia-pago';

const CobroSchema = z.object({
  id: z.string().uuid(), sesionId: z.string().uuid(),
  medioPago: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CHEQUE']),
  valor: z.number().positive(), referencia: z.string().optional(),
  facturaId: z.string().uuid().optional(), pedidoId: z.string().uuid().optional(),
});

@Injectable()
export class CajaCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos) {}

  /** R8: abrir sesión. La base de datos garantiza una sola abierta por caja y por usuario. */
  async abrirSesion(u: { empresaId: string; id: string }, d: { id: string; cajaId: string; montoApertura: number }) {
    try {
      await this.bd.consultar(
        `INSERT INTO caja.sesion_caja (id, empresa_id, caja_id, usuario_id, estado, monto_apertura)
         VALUES ($1,$2,$3,$4,'ABIERTA',$5) ON CONFLICT (id) DO NOTHING`, [d.id, u.empresaId, d.cajaId, u.id, d.montoApertura]);
    } catch (e: any) {
      if (e.code === '23505') throw new ErrorNegocio('R8_SESION_ABIERTA', 'Ya existe una sesión abierta para esta caja o para este usuario');
      throw e;
    }
    return {};
  }

  /** Cobro idempotente: el movimiento solo se inserta una vez por idempotencyKey. */
  async registrarCobro(u: { empresaId: string; id: string }, entrada: unknown, idempotencyKey: string) {
    const d = CobroSchema.parse(entrada);
    const ref = ReferenciaPago.crear(d.medioPago, d.referencia);                    // R10 (dominio)
    if (!ref.ok) throw new ErrorNegocio('R10_REFERENCIA_INVALIDA', ref.error);

    return this.bd.transaccion(async () => {
      const [s] = await this.bd.consultar(
        `SELECT id FROM caja.sesion_caja WHERE id=$1 AND empresa_id=$2 AND usuario_id=$3 AND estado='ABIERTA' FOR SHARE`,
        [d.sesionId, u.empresaId, u.id]);
      if (!s) throw new ErrorNegocio('SESION_NO_ABIERTA', 'No tiene una sesión de caja abierta');

      const nuevo = await this.bd.consultar(
        `INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia,
                                           factura_id, pedido_id, idempotency_key, usuario_id)
         VALUES ($1,$2,$3,'COBRO','ENTRADA',$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [d.id, u.empresaId, d.sesionId, d.medioPago, d.valor, ref.valor.valor, d.facturaId ?? null, d.pedidoId ?? null, idempotencyKey, u.id]);
      if (nuevo.length === 0) return {};                                               // reintento: ya registrado

      await this.eventos.publicar([{
        tipo: 'caja.CobroRegistrado', agregadoId: d.id, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { movimientoId: d.id, facturaId: d.facturaId ?? null, pedidoId: d.pedidoId ?? null, valor: d.valor, medioPago: d.medioPago },
      }]);
      return {};
    });
  }

  /** R9: un error se corrige con un movimiento inverso (el trigger valida que sea exactamente inverso). */
  async reversar(u: { empresaId: string; id: string }, d: { id: string; movimientoId: string; motivo: string }) {
    return this.bd.transaccion(async () => {
      const [o] = await this.bd.consultar(
        `SELECT * FROM caja.movimiento_caja WHERE id=$1 AND empresa_id=$2`, [d.movimientoId, u.empresaId]);
      if (!o) throw new ErrorNegocio('MOVIMIENTO_NO_EXISTE', 'El movimiento no existe');
      await this.bd.consultar(
        `INSERT INTO caja.movimiento_caja (id, empresa_id, sesion_id, tipo, sentido, medio_pago, valor, referencia,
                                           factura_id, pedido_id, id_movimiento_relacionado, idempotency_key, usuario_id)
         VALUES ($1,$2,$3,'REVERSO',$4,$5,$6,$7,$8,$9,$10,$1,$11)`,
        [d.id, u.empresaId, o.sesion_id, o.sentido === 'ENTRADA' ? 'SALIDA' : 'ENTRADA', o.medio_pago, o.valor,
         `REV:${d.motivo}`.slice(0, 80), o.factura_id, o.pedido_id, o.id, u.id]);
      await this.eventos.publicar([{
        tipo: 'caja.MovimientoReversado', agregadoId: d.id, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { movimientoReversoId: d.id, movimientoOriginalId: o.id, facturaId: o.factura_id },
      }]);
      return {};
    });
  }
}
```

> En `CajaModule` (mismo patrón que Pedidos) se registran los comandos de sincronización `caja.cobro.registrar` (permitido offline para efectivo) y se exponen por REST `abrirSesion`, `cerrarSesion` (genera el arqueo de cierre con la vista `v_saldo_efectivo_sesion`) y `reversar` (permiso `caja.movimiento.reversar`, solo en línea).

### 7.10 Módulo Facturación (R6, R7, R14)

```ts
// src/modulos/facturacion/aplicacion/facturacion.casos-uso.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { PedidosApi } from '../../pedidos';                    // API pública de Pedidos

@Injectable()
export class FacturacionCasosUso {
  constructor(private readonly bd: BaseDatos, private readonly eventos: PublicadorEventos, private readonly pedidos: PedidosApi) {}

  /** Contador: emite la factura de un pedido confirmado. R14: el número se toma en la MISMA transacción. */
  async emitir(u: { empresaId: string; id: string }, d: { facturaId: string; pedidoId: string; prefijo: string }) {
    return this.bd.transaccion(async () => {
      const [ya] = await this.bd.consultar(
        `SELECT id, prefijo, numero FROM facturacion.factura WHERE empresa_id=$1 AND pedido_id=$2 AND estado<>'ANULADA'`, [u.empresaId, d.pedidoId]);
      if (ya) return { facturaId: ya.id, numero: `${ya.prefijo}${ya.numero}` };            // idempotente

      const p = await this.pedidos.obtenerParaFacturar(u.empresaId, d.pedidoId);
      if (!p) throw new ErrorNegocio('PEDIDO_NO_FACTURABLE', 'El pedido no existe o no está confirmado');

      const [serie] = await this.bd.consultar(
        `SELECT id FROM facturacion.serie_documento WHERE empresa_id=$1 AND tipo='FACTURA' AND prefijo=$2`, [u.empresaId, d.prefijo]);
      if (!serie) throw new ErrorNegocio('SERIE_NO_EXISTE', 'La serie de facturación no existe');

      // R14: UPDATE ... RETURNING con bloqueo de fila. Si algo falla más abajo, el ROLLBACK devuelve el número.
      const [{ n }] = await this.bd.consultar(`SELECT facturacion.siguiente_numero($1,'FACTURA',$2) AS n`, [u.empresaId, d.prefijo]);

      const dias = p.condicionPago === 'CREDITO' ? 30 : 0;      // en un sistema real: plazo del cliente
      await this.bd.consultar(
        `INSERT INTO facturacion.factura (id, empresa_id, serie_id, prefijo, numero, pedido_id, cliente_id,
                                          subtotal, impuestos, total, saldo, fecha_vencimiento, emitida_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, current_date + $11::int, $12)`,
        [d.facturaId, u.empresaId, serie.id, d.prefijo, n, d.pedidoId, p.clienteId, p.subtotal, p.impuestos, p.total, dias, u.id]);
      for (const l of p.lineas) {
        await this.bd.consultar(
          `INSERT INTO facturacion.factura_linea (id, empresa_id, factura_id, articulo_id, descripcion, cantidad, precio_unitario, iva_pct, total_linea)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)`,
          [u.empresaId, d.facturaId, l.articuloId, l.descripcion, l.cantidad, l.precioUnitario, l.ivaPct, l.totalLinea]);
      }
      await this.eventos.publicar([{
        tipo: 'facturacion.FacturaEmitida', agregadoId: d.facturaId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { facturaId: d.facturaId, pedidoId: d.pedidoId, clienteId: p.clienteId, total: p.total, prefijo: d.prefijo, numero: Number(n) },
      }]);
      return { facturaId: d.facturaId, numero: `${d.prefijo}${n}` };
    });
  }

  /** R6: una factura emitida no se borra; se anula con una nota de crédito (también numerada sin saltos). */
  async anular(u: { empresaId: string; id: string }, d: { notaId: string; facturaId: string; prefijoNc: string; motivo: string }) {
    return this.bd.transaccion(async () => {
      const [f] = await this.bd.consultar(
        `SELECT * FROM facturacion.factura WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [d.facturaId, u.empresaId]);
      if (!f) throw new ErrorNegocio('FACTURA_NO_EXISTE', 'La factura no existe');
      if (f.estado === 'ANULADA') return {};                                              // idempotente
      const [{ pagos }] = await this.bd.consultar(
        `SELECT count(*)::int AS pagos FROM facturacion.pago_factura WHERE factura_id=$1 AND estado='APLICADO'`, [d.facturaId]);
      if (pagos > 0) throw new ErrorNegocio('FACTURA_CON_PAGOS', 'Reverse primero los pagos aplicados en caja (R9)');

      const [{ n }] = await this.bd.consultar(`SELECT facturacion.siguiente_numero($1,'NOTA_CREDITO',$2) AS n`, [u.empresaId, d.prefijoNc]);
      await this.bd.consultar(
        `INSERT INTO facturacion.nota_credito (id, empresa_id, factura_id, prefijo, numero, tipo, motivo, total, emitida_por)
         VALUES ($1,$2,$3,$4,$5,'ANULACION_TOTAL',$6,$7,$8)`,
        [d.notaId, u.empresaId, d.facturaId, d.prefijoNc, n, d.motivo, f.total, u.id]);
      await this.bd.consultar(`UPDATE facturacion.factura SET estado='ANULADA', saldo=0 WHERE id=$1`, [d.facturaId]);
      await this.eventos.publicar([{
        tipo: 'facturacion.FacturaAnulada', agregadoId: d.facturaId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { facturaId: d.facturaId, pedidoId: f.pedido_id, notaCreditoId: d.notaId },
      }]);
      return {};
    });
  }
}
```

```ts
// src/modulos/facturacion/facturacion.module.ts  (suscripciones a Caja: R7 y R9)
// Se registran en onModuleInit() igual que en Pedidos:
this.bus.suscribir('caja.CobroRegistrado', async (e) => {
  const p = e.payload;
  if (!p.facturaId) return;                                   // cobro sin factura (anticipo, mostrador)
  // R7: el trigger recalcula el saldo; si el pago excede el saldo, ck_r7_saldo_en_rango lo rechaza
  await this.bd.consultar(
    `INSERT INTO facturacion.pago_factura (id, empresa_id, factura_id, movimiento_caja_id, valor, medio_pago)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) ON CONFLICT (movimiento_caja_id) DO NOTHING`,
    [e.empresa_id, p.facturaId, p.movimientoId, p.valor, p.medioPago]);
});
this.bus.suscribir('caja.MovimientoReversado', async (e) => {
  await this.bd.consultar(
    `UPDATE facturacion.pago_factura SET estado='REVERSADO' WHERE movimiento_caja_id=$1 AND empresa_id=$2`,
    [e.payload.movimientoOriginalId, e.empresa_id]);       // el trigger R7 recalcula el saldo
});
```

### 7.11 Módulos Despacho y Compras (R11, R12)

```ts
// src/modulos/despacho/aplicacion/despachar-pedido.ts
import { Injectable } from '@nestjs/common';
import { BaseDatos } from '../../../infraestructura/base-datos';
import { PublicadorEventos } from '../../../infraestructura/eventos';
import { ErrorNegocio } from '../../../kernel/errores';
import { InventariosApi } from '../../inventarios';

@Injectable()
export class DespacharPedido {
  constructor(private readonly bd: BaseDatos, private readonly inv: InventariosApi, private readonly eventos: PublicadorEventos) {}

  /** Bodeguero. R12: sin reserva ACTIVA no hay despacho (InventariosApi lanza R12_SIN_RESERVA_ACTIVA). */
  async ejecutar(u: { empresaId: string; id: string }, d: { despachoId: string; pedidoId: string; direccionEntrega: string }) {
    return this.bd.transaccion(async () => {
      const [ya] = await this.bd.consultar(`SELECT id FROM despacho.despacho WHERE id=$1 AND empresa_id=$2`, [d.despachoId, u.empresaId]);
      if (ya) return {};                                                                  // reintento idempotente

      const reservas = await this.inv.reservasActivas(u.empresaId, d.pedidoId);
      if (reservas.length === 0) throw new ErrorNegocio('R12_SIN_RESERVA_ACTIVA', 'El pedido no tiene stock reservado para despachar');

      const [p] = await this.bd.consultar(`SELECT cliente_id, bodega_id FROM pedidos.pedido WHERE id=$1 AND empresa_id=$2`, [d.pedidoId, u.empresaId]);
      // ^ lectura de solo los 2 campos que Despacho necesita; en una versión más estricta se pide a PedidosApi.

      await this.inv.consumirReservas({ empresaId: u.empresaId, reservaIds: reservas.map(r => r.id), despachoId: d.despachoId, usuarioId: u.id });
      await this.bd.consultar(
        `INSERT INTO despacho.despacho (id, empresa_id, pedido_id, cliente_id, bodega_id, direccion_entrega, estado, despachado_por, despachado_en)
         VALUES ($1,$2,$3,$4,$5,$6,'DESPACHADO',$7,now())`,
        [d.despachoId, u.empresaId, d.pedidoId, p.cliente_id, p.bodega_id, d.direccionEntrega, u.id]);
      for (const r of reservas) {
        await this.bd.consultar(
          `INSERT INTO despacho.despacho_linea (id, empresa_id, despacho_id, pedido_linea_id, articulo_id, cantidad, reserva_id)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`, [u.empresaId, d.despachoId, r.pedido_linea_id, r.articulo_id, r.cantidad, r.id]);
      }
      const [pend] = await this.bd.consultar(
        `SELECT count(*)::int AS n FROM pedidos.pedido_linea WHERE pedido_id=$1 AND eliminado_en IS NULL AND cantidad_a_fabricar > 0`, [d.pedidoId]);
      await this.eventos.publicar([{
        tipo: 'despacho.DespachoRealizado', agregadoId: d.despachoId, empresaId: u.empresaId, ocurrioEn: new Date(),
        datos: { despachoId: d.despachoId, pedidoId: d.pedidoId, completo: pend.n === 0 },
      }]);
      return {};
    });
  }
}
```

```ts
// Compras: registrar recepción (R11) — actualiza líneas, luego estado, y publica el evento hacia Inventarios
async registrarRecepcion(u, d: { recepcionId: string; ordenId: string; lineas: { ordenLineaId: string; cantidad: number }[] }) {
  return this.bd.transaccion(async () => {
    const detalle = [];
    for (const l of d.lineas) {
      const [x] = await this.bd.consultar(
        `UPDATE compras.orden_compra_linea SET cantidad_recibida = cantidad_recibida + $2
          WHERE id=$1 AND empresa_id=$3 AND cantidad_recibida + $2 <= cantidad
          RETURNING articulo_id, costo_unitario`, [l.ordenLineaId, l.cantidad, u.empresaId]);
      if (!x) throw new ErrorNegocio('RECEPCION_EXCEDE_ORDEN', 'La cantidad recibida excede lo pedido en la orden');
      detalle.push({ recepcionLineaId: crypto.randomUUID(), ordenLineaId: l.ordenLineaId, articuloId: x.articulo_id,
                     cantidad: l.cantidad, costoUnitario: Number(x.costo_unitario) });
    }
    // ... INSERT compras.recepcion y compras.recepcion_linea (con los ids de 'detalle') ...
    await this.bd.consultar(
      `UPDATE compras.orden_compra o SET estado = CASE WHEN NOT EXISTS (
           SELECT 1 FROM compras.orden_compra_linea WHERE orden_id=o.id AND cantidad_recibida < cantidad)
         THEN 'RECIBIDA' ELSE 'RECIBIDA_PARCIAL' END WHERE id=$1`, [d.ordenId]);
    await this.eventos.publicar([{ tipo: 'compras.RecepcionRegistrada', agregadoId: d.recepcionId, empresaId: u.empresaId,
      ocurrioEn: new Date(), datos: { recepcionId: d.recepcionId, ordenId: d.ordenId, bodegaId: /* de la orden */ '', lineas: detalle } }]);
    return {};
  });
}
// El comprador CIERRA la orden en un paso posterior (estado 'CERRADA'): el trigger R11 lo rechaza si falta mercadería.
```

### 7.12 `AppModule`, arranque y endpoints por rol

```ts
// src/app.module.ts
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { BaseDatos } from './infraestructura/base-datos';
import { BusEventos, DespachadorOutbox, PublicadorEventos } from './infraestructura/eventos';
import { SincronizacionModule } from './modulos/sincronizacion';
import { InventariosModule } from './modulos/inventarios';
import { PedidosModule } from './modulos/pedidos/pedidos.module';
import { FabricacionModule } from './modulos/fabricacion/fabricacion.module';
// ... CajaModule, FacturacionModule, ComprasModule, DespachoModule, CatalogoModule, SeguridadModule

@Global()
@Module({
  providers: [
    { provide: Pool, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }) },
    BaseDatos, BusEventos, PublicadorEventos, DespachadorOutbox,
  ],
  exports: [BaseDatos, BusEventos, PublicadorEventos],
})
export class NucleoModule {}

@Module({
  imports: [NucleoModule, SincronizacionModule, InventariosModule, PedidosModule, FabricacionModule
            /*, CajaModule, FacturacionModule, ComprasModule, DespachoModule, CatalogoModule, SeguridadModule */],
})
export class AppModule {}
```

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function arrancar() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: [process.env.WEB_ORIGIN ?? 'http://localhost:3000'], credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
arrancar();
```

Endpoints REST principales y comandos de sincronización por actor:

| Actor | REST (en línea) | Comando offline (`/sync/push`) |
|---|---|---|
| Vendedor | `POST /pedidos`, `POST /pedidos/:id/confirmar` | `pedidos.pedido.guardar_borrador`, `pedidos.pedido.confirmar`, `caja.cobro.registrar` |
| Cliente web | `GET /tienda/catalogo`, `POST /tienda/checkout`, `GET /tienda/pedidos/:id` | — |
| Supervisor de ventas | `POST /pedidos/:id/aprobar`, `POST /pedidos/:id/cancelar` | — |
| Bodeguero | `POST /despachos`, `POST /compras/recepciones` | `inventarios.conteo.guardar`, `compras.recepcion.registrar`, `despacho.despacho.registrar` |
| Planificador | `GET /fabricacion/ordenes` | `fabricacion.orden.liberar`, `fabricacion.orden.reportar` |
| Cajero | `POST /caja/sesiones`, `POST /caja/sesiones/:id/cerrar`, `POST /caja/movimientos/:id/reversar` | `caja.cobro.registrar` (solo efectivo/transferencia) |
| Contador | `POST /facturas`, `POST /facturas/:id/anular`, `GET /cartera` | — |
| Comprador | `POST /compras/ordenes`, `POST /compras/ordenes/:id/aprobar`, `POST /compras/ordenes/:id/cerrar` | `compras.orden.guardar_borrador` |
| Administrador | `/seguridad/usuarios`, `/seguridad/roles`, `/catalogo/*` | — |

> **Cómo agregar los módulos restantes** (Compras, Despacho, Catálogo, Seguridad): crear las 4 carpetas
> `dominio / aplicacion / infraestructura / presentacion`, un agregado con sus reglas, un repositorio `*Pg`, casos de uso,
> un controller y registrar sus **comandos de sincronización** y **suscripciones a eventos** en `onModuleInit()`,
> siguiendo exactamente el patrón de Pedidos.

---

## 8. Autenticación y autorización: OAuth 2.0 / OIDC

### 8.1 Modelo

| Elemento | Implementación |
|---|---|
| Servidor de autorización | **Supabase Auth (GoTrue)** en `auth.sierrainnova.tech` (OpenID Connect) |
| Flujo para la web/PWA | **Authorization Code + PKCE** (cliente público, sin secreto en el navegador) |
| Proveedores de identidad | Correo/contraseña, Google, Microsoft (configurables en Supabase) |
| Tokens | `access_token` JWT corto (≈1 h) + `refresh_token` rotativo |
| API (NestJS) | Servidor de recursos: valida firma (JWKS), `iss`, `aud` y expiración |
| Autorización | RBAC por empresa: `seguridad.usuario_empresa` → roles (uno o varios) → permisos |
| Servicio Python | Valida el mismo JWT |

### 8.2 Guard de NestJS (varios roles por usuario)

```ts
// src/infraestructura/auth.ts
import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { BaseDatos } from './base-datos';

export const Permiso = (codigo: string) => SetMetadata('permiso', codigo);

// Claves públicas del emisor (se cachean automáticamente)
const jwks = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!));
// Si tu instancia firma con HS256 (secreto compartido), usa en su lugar:
// const secreto = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
// y llama jwtVerify(token, secreto, {...})

export interface UsuarioAutenticado {
  id: string; empresaId: string; roles: string[]; permisos: string[];
  clienteId: string | null;          // solo para el rol 'cliente_web'
}

@Injectable()
export class AuthGuard implements CanActivate {
  private cache = new Map<string, { u: UsuarioAutenticado; hasta: number }>();
  constructor(private readonly bd: BaseDatos, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Falta el token');

    let sub: string;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE,
      });
      sub = String(payload.sub);
    } catch { throw new UnauthorizedException('Token inválido o vencido'); }

    const empresaSolicitada = (req.headers['x-empresa-id'] as string | undefined) ?? null;
    const llave = `${sub}:${empresaSolicitada}`;
    let entrada = this.cache.get(llave);
    if (!entrada || entrada.hasta < Date.now()) {
      // Se UNEN los permisos de todos los roles que el usuario tiene en la empresa
      const [f] = await this.bd.consultar(
        `SELECT ue.empresa_id,
                array_agg(DISTINCT r.codigo) AS roles,
                array_remove(array_agg(DISTINCT p.codigo), NULL) AS permisos,
                max(ue.cliente_id::text) AS cliente_id
           FROM seguridad.usuario_empresa ue
           JOIN seguridad.rol r ON r.id = ue.rol_id
           LEFT JOIN seguridad.rol_permiso rp ON rp.rol_id = r.id
           LEFT JOIN seguridad.permiso p ON p.id = rp.permiso_id
          WHERE ue.usuario_id = $1 AND ue.activo AND ($2::uuid IS NULL OR ue.empresa_id = $2::uuid)
          GROUP BY ue.empresa_id
          LIMIT 1`, [sub, empresaSolicitada]);
      if (!f) throw new ForbiddenException('Sin acceso a la empresa');
      entrada = {
        u: { id: sub, empresaId: f.empresa_id, roles: f.roles, permisos: f.permisos, clienteId: f.cliente_id },
        hasta: Date.now() + 60_000,
      };
      this.cache.set(llave, entrada);
    }
    req.usuario = entrada.u;

    const requerido = this.reflector.get<string>('permiso', ctx.getHandler());
    if (requerido && !entrada.u.permisos.includes(requerido) && !entrada.u.roles.includes('administrador'))
      throw new ForbiddenException(`Falta el permiso ${requerido}`);
    return true;
  }
}
```

> La caché de 60 s significa que un cambio de rol puede tardar hasta un minuto en aplicarse. Para revocación inmediata, invalidar la caché al modificar `seguridad.usuario_empresa`.

### 8.3 Configuración de Supabase Auth (producción)

Variables del contenedor `auth` (GoTrue) en `infra/.env`:

```env
API_EXTERNAL_URL=https://auth.sierrainnova.tech
GOTRUE_SITE_URL=https://app.sierrainnova.tech
GOTRUE_URI_ALLOW_LIST=https://app.sierrainnova.tech/**
GOTRUE_JWT_EXP=3600
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<client-id>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://auth.sierrainnova.tech/auth/v1/callback
```

Reglas de seguridad obligatorias: HTTPS en todo, `redirect_uri` exactas, PKCE siempre, refresh tokens rotativos,
cabeceras `Content-Security-Policy`, y rate-limit en `/auth` (Nginx, ver paso 14).

---

## 9. Estrategia Offline-First y sincronización

### 9.1 Principios

1. **La UI lee y escribe siempre contra la base local** (IndexedDB). Nunca espera a la red.
2. Cada escritura local crea una **operación en el outbox** (`pendiente`).
3. El **motor de sincronización** envía el outbox (*push*) y descarga cambios del servidor (*pull*).
4. El servidor es la **fuente de verdad** y valida las reglas de negocio; puede **rechazar** una operación (ej. sin stock) y el cliente lo muestra.
5. Los datos de referencia (catálogos, clientes, existencias) se descargan por **secuencia incremental** (`sync.cambios`).

```mermaid
sequenceDiagram
    participant UI as UI React
    participant DB as IndexedDB (Dexie)
    participant MS as Motor de Sync
    participant API as API NestJS
    participant PG as PostgreSQL
    participant RT as Supabase Realtime

    UI->>DB: Guardar pedido (borrador) + operación en outbox
    Note over UI,DB: Sin red: todo sigue funcionando
    MS->>API: POST /sync/push {operaciones}
    API->>PG: Ejecuta comandos (idempotentes) en transacción
    PG-->>API: OK / RECHAZADO por operación
    API-->>MS: resultados
    PG->>RT: trigger actualiza sync.senal
    RT-->>MS: "hay cambios (secuencia N)"
    MS->>API: GET /sync/pull?desde=M
    API-->>MS: cambios M+1..N
    MS->>DB: Aplica cambios y actualiza UI
```

### 9.2 Políticas de resolución de conflictos

| Tipo de dato | Ejemplos | Política |
|---|---|---|
| **Comandos transaccionales con reglas** | Confirmar pedido (R1, R2, R13), despacho (R12), cobro en caja | **Comandos idempotentes**; el servidor decide y puede devolver `RECHAZADO` o un estado distinto (por ejemplo `PENDIENTE_APROBACION`). El estado final lo define el servidor |
| **Cantidades acumulativas** | Existencias, reservas, saldos de facturas | **Solo movimientos** (kardex, pagos); el cliente nunca envía "stock = X" ni "saldo = X". Existencias y saldos son de **solo lectura** en el cliente |
| **Registros inmutables** | Movimientos de caja (R9), kardex (R5) | **Solo insertar**; un error se corrige con un movimiento inverso, nunca con una edición |
| **Catálogos** | Artículos, clientes, proveedores | **Concurrencia optimista** con `versionBase`; si no coincide, respuesta `CONFLICTO` y el usuario elige (o última escritura gana según el campo) |
| **Borradores propios** | Pedido en borrador, borrador de OC, conteos | El dispositivo que lo creó es el dueño; se sobrescribe sin conflicto |
| **Numeración** | Pedido, OF, **facturas y notas de crédito (R14)** | **Siempre el servidor** (o rango reservado por terminal en facturación) |

### 9.3 Protocolo de la API de sincronización

**`POST /v1/sync/push`**

```json
{
  "dispositivoId": "5f6d...-uuid",
  "operaciones": [
    {
      "idempotencyKey": "0198...-uuid",
      "tipo": "pedidos.pedido.guardar_borrador",
      "datos": { "id": "...", "clienteId": "...", "bodegaId": "...", "lineas": [ ... ] },
      "creadoEn": "2026-11-04T15:30:00Z"
    },
    { "idempotencyKey": "0198...-uuid", "tipo": "pedidos.pedido.confirmar", "datos": { "pedidoId": "..." }, "creadoEn": "..." }
  ]
}
```

Respuesta:

```json
{ "resultados": [
  { "idempotencyKey": "...", "estado": "OK", "datos": {} },
  { "idempotencyKey": "...", "estado": "RECHAZADO", "codigo": "PEDIDO_INVALIDO", "mensaje": "..." }
] }
```

**`GET /v1/sync/pull?desde=1200&limite=500`**

```json
{ "cambios": [ { "secuencia": 1201, "tabla": "pedidos.pedido", "registroId": "...", "operacion": "U", "version": 3, "payload": { ... } } ],
  "hasta": 1250, "hayMas": false }
```

### 9.4 Módulo de sincronización (backend)

```ts
// src/modulos/sincronizacion/index.ts   (API pública del módulo)
export { SincronizacionModule } from './sincronizacion.module';
export { RegistroComandosSync } from './registro-comandos';
```

```ts
// src/modulos/sincronizacion/registro-comandos.ts
import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../infraestructura/auth';

export type ComandoSync = (usuario: UsuarioAutenticado, datos: any, idempotencyKey: string) => Promise<Record<string, unknown>>;

@Injectable()
export class RegistroComandosSync {
  private comandos = new Map<string, ComandoSync>();
  registrar(tipo: string, fn: ComandoSync) { this.comandos.set(tipo, fn); }
  obtener(tipo: string) { return this.comandos.get(tipo); }
}
```

```ts
// src/modulos/sincronizacion/sincronizacion.controller.ts
import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../infraestructura/auth';
import { BaseDatos } from '../../infraestructura/base-datos';
import { ErrorNegocio } from '../../kernel/errores';
import { RegistroComandosSync } from './registro-comandos';

const PushSchema = z.object({
  dispositivoId: z.string().uuid(),
  operaciones: z.array(z.object({
    idempotencyKey: z.string().uuid(), tipo: z.string(), datos: z.any(), creadoEn: z.string(),
  })).max(200),
});

// Qué tablas puede descargar cada rol. Un usuario con varios roles recibe la UNIÓN.
// (El cliente web no sincroniza: usa los endpoints /tienda.)
const TABLAS_POR_ROL: Record<string, string[]> = {
  vendedor: ['catalogo.articulo','catalogo.cliente','pedidos.cliente','pedidos.pedido','pedidos.pedido_linea',
             'inventarios.bodega','inventarios.existencia','caja.caja','caja.sesion_caja','caja.movimiento_caja','facturacion.factura'],
  supervisor_ventas: ['catalogo.articulo','catalogo.cliente','pedidos.cliente','pedidos.pedido','pedidos.pedido_linea','pedidos.aprobacion',
                      'inventarios.existencia'],
  bodeguero: ['catalogo.articulo','inventarios.bodega','inventarios.existencia','inventarios.conteo','inventarios.conteo_linea',
              'compras.proveedor','compras.orden_compra','compras.orden_compra_linea','compras.recepcion','compras.recepcion_linea',
              'pedidos.pedido','pedidos.pedido_linea','despacho.despacho','despacho.despacho_linea'],
  planificador_produccion: ['catalogo.articulo','inventarios.bodega','inventarios.existencia','pedidos.pedido_linea','fabricacion.orden_fabricacion'],
  cajero: ['catalogo.cliente','pedidos.cliente','pedidos.pedido','caja.caja','caja.sesion_caja','caja.movimiento_caja','caja.arqueo',
           'facturacion.factura','facturacion.pago_factura'],
  contador: ['catalogo.cliente','pedidos.cliente','pedidos.pedido','facturacion.factura','facturacion.factura_linea',
             'facturacion.pago_factura','facturacion.nota_credito','caja.caja','caja.sesion_caja','caja.movimiento_caja','caja.arqueo'],
  comprador: ['catalogo.articulo','inventarios.existencia','compras.proveedor','compras.orden_compra','compras.orden_compra_linea',
              'compras.recepcion','compras.recepcion_linea'],
  administrador: ['*'],
};

@Controller('sync')
@UseGuards(AuthGuard)
export class SincronizacionController {
  constructor(private readonly bd: BaseDatos, private readonly registro: RegistroComandosSync) {}

  @Post('push')
  async push(@Req() req: any, @Body() body: unknown) {
    const { dispositivoId, operaciones } = PushSchema.parse(body);
    const u = req.usuario;
    const resultados: any[] = [];

    // Se procesan EN ORDEN. Un rechazo de negocio no detiene el lote; un error técnico sí (se reintenta luego).
    for (const op of operaciones) {
      const [previo] = await this.bd.consultar(
        `SELECT resultado FROM sync.operacion_procesada WHERE idempotency_key = $1`, [op.idempotencyKey]);
      if (previo) { resultados.push(previo.resultado); continue; }

      const comando = this.registro.obtener(op.tipo);
      if (!comando) throw new BadRequestException(`Operación desconocida: ${op.tipo}`);

      let resultado: any;
      try {
        resultado = await this.bd.transaccion(async () => {
          const datos = await comando(u, op.datos, op.idempotencyKey);
          const r = { idempotencyKey: op.idempotencyKey, estado: 'OK', datos };
          await this.guardarProcesada(u.empresaId, dispositivoId, op, r);
          return r;
        });
      } catch (e) {
        if (e instanceof ErrorNegocio || (e as any)?.name === 'ZodError') {
          resultado = { idempotencyKey: op.idempotencyKey, estado: 'RECHAZADO',
                        codigo: (e as any).codigo ?? 'VALIDACION', mensaje: (e as Error).message };
          await this.guardarProcesada(u.empresaId, dispositivoId, op, resultado);
        } else throw e;
      }
      resultados.push(resultado);
    }
    await this.bd.consultar(
      `INSERT INTO sync.dispositivo (id, empresa_id, usuario_id, ultima_sync) VALUES ($1,$2,$3,now())
       ON CONFLICT (id) DO UPDATE SET ultima_sync = now()`, [dispositivoId, u.empresaId, u.id]);
    return { resultados };
  }

  @Get('pull')
  async pull(@Req() req: any, @Query('desde') desde = '0', @Query('limite') limite = '500') {
    const u = req.usuario;
    const lim = Math.min(Number(limite) || 500, 1000);
    const tablas = [...new Set((u.roles as string[]).flatMap(r => TABLAS_POR_ROL[r] ?? []))];
    const todas = tablas.includes('*');
    const filas = await this.bd.consultar(
      `SELECT secuencia, tabla, registro_id AS "registroId", operacion, version, payload
         FROM sync.cambios
        WHERE empresa_id = $1 AND secuencia > $2 AND ($3::boolean OR tabla = ANY($4::text[]))
        ORDER BY secuencia LIMIT $5`,
      [u.empresaId, Number(desde), todas, tablas, lim + 1]);
    const hayMas = filas.length > lim;
    const cambios = hayMas ? filas.slice(0, lim) : filas;
    const hasta = cambios.length ? Number(cambios[cambios.length - 1].secuencia) : Number(desde);
    return { cambios, hasta, hayMas };
  }

  private guardarProcesada(empresaId: string, dispositivoId: string, op: any, r: any) {
    return this.bd.consultar(
      `INSERT INTO sync.operacion_procesada (idempotency_key, empresa_id, dispositivo_id, tipo, resultado)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [op.idempotencyKey, empresaId, dispositivoId, op.tipo, JSON.stringify(r)]);
  }
}
```

```ts
// src/modulos/sincronizacion/sincronizacion.module.ts
import { Global, Module } from '@nestjs/common';
import { AuthGuard } from '../../infraestructura/auth';
import { RegistroComandosSync } from './registro-comandos';
import { SincronizacionController } from './sincronizacion.controller';

@Global()
@Module({
  controllers: [SincronizacionController],
  providers: [RegistroComandosSync, AuthGuard],
  exports: [RegistroComandosSync, AuthGuard],
})
export class SincronizacionModule {}
```

> `secuencia` se devuelve como string por `pg` (bigint); en el cliente se maneja con `Number()` (seguro hasta 2^53).
> En `AppModule` y en los módulos, `AuthGuard` y `Reflector` deben estar disponibles (importar `SincronizacionModule`, que es `@Global`).

### 9.5 Reglas de negocio y comportamiento offline

El servidor es el único que aplica R1–R14. El cliente muestra ayudas locales, pero nunca asume el resultado:

| Regla | Qué hace el cliente offline | Qué decide el servidor al sincronizar |
|---|---|---|
| R1, R2, R3 | Muestra existencias locales (informativas) y deja confirmar el pedido | Reserva lo disponible, calcula el faltante y genera la OF. La línea llega con `cantidad_reservada` / `cantidad_a_fabricar` por `pull` |
| R13 | Puede estimar el cupo con `pedidos.cliente` local y advertir | Si excede, el pedido queda `PENDIENTE_APROBACION` (no es un error) hasta que el supervisor apruebe |
| R8 | **Abrir sesión de caja requiere conexión** | Garantiza una sola sesión abierta por caja y por usuario |
| R9, R10 | Registra cobros en **efectivo/transferencia** en una sesión ya abierta. **Tarjeta solo en línea** (necesita token de la pasarela) | Valida la referencia (sin datos de tarjeta) y el reverso exacto |
| R12 | El bodeguero registra el despacho en la cola | Solo lo acepta si hay reservas activas; si no, `RECHAZADO` con `R12_SIN_RESERVA_ACTIVA` |
| R14, R6 | No numera ni anula documentos fiscales | Numeración correlativa en la emisión; anulación solo con nota de crédito |
| R11 | Borradores de OC y recepciones en la cola | Rechaza cerrar la OC si falta mercadería |

La UI debe distinguir tres estados de una operación: **pendiente de enviar**, **aceptada** y **rechazada** (con el código de la regla), y ofrecer corregir o descartar.

---
## 10. Frontend: Next.js + React PWA

```bash
cd apps/web
pnpm add dexie dexie-react-hooks @supabase/supabase-js uuid zod @serwist/next
pnpm add -D serwist @types/uuid
```

> **Nota sobre Serwist:** `@serwist/next` funciona con el compilador webpack de Next.js (`next build --webpack`).
> Si tu versión de Next.js usa Turbopack por defecto, usa la integración `@serwist/turbopack` o fuerza webpack para el *build*.

### 10.1 Estructura de `src/offline/`

```
src/offline/
├── db.ts            # Base local (Dexie)
├── api.ts           # Cliente HTTP con token OAuth
├── motor-sync.ts    # Push / Pull / Realtime
├── repos/
│   ├── pedidos.ts   # Escrituras locales + outbox (una por agregado)
│   └── caja.ts      # Cobros en efectivo offline
└── AutoSync.tsx     # Componente que arranca el motor
```

### 10.2 Cliente OAuth 2.0 (Authorization Code + PKCE)

```ts
// src/auth/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,        // https://auth.sierrainnova.tech
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
```

```tsx
// src/app/login/page.tsx
'use client';
import { supabase } from '@/auth/supabase';

export default function Login() {
  const entrarConGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

  return (
    <main className="grid min-h-screen place-items-center">
      <button onClick={entrarConGoogle} className="rounded-xl bg-slate-900 px-6 py-3 text-white">
        Ingresar con Google
      </button>
    </main>
  );
}
```

```tsx
// src/app/auth/callback/page.tsx   (el SDK intercambia el "code" por tokens usando el verificador PKCE)
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/auth/supabase';

export default function Callback() {
  const router = useRouter();
  useEffect(() => {
    supabase.auth.getSession().then(() => router.replace('/'));
  }, [router]);
  return <p>Validando sesión…</p>;
}
```

> **Sesión sin conexión:** el `access_token` caduca (~1 h) pero la app debe abrir offline. La sesión y el `refresh_token`
> permanecen en el almacenamiento local; la app abre y trabaja contra IndexedDB. Al volver la red, el SDK renueva
> el token y el motor envía el outbox. Define una política de negocio (ej. máx. 7 días sin reconectar) para forzar nuevo login.

### 10.3 Base de datos local (Dexie / IndexedDB)

```ts
// src/offline/db.ts
import Dexie, { Table } from 'dexie';

export type EstadoOperacion = 'pendiente' | 'rechazada';

export interface Operacion {
  idempotencyKey: string;
  tipo: string;                 // 'pedidos.pedido.guardar_borrador'
  datos: unknown;
  registroId: string;           // para no pisar registros con cambios locales pendientes
  creadoEn: string;
  estado: EstadoOperacion;
  error?: string;               // mensaje/código devuelto por el servidor (ej. R12_SIN_RESERVA_ACTIVA)
}

class BdLocal extends Dexie {
  // Datos maestros
  articulos!: Table<any, string>;
  clientes!: Table<any, string>;
  clientes_credito!: Table<any, string>;
  // Pedidos
  pedidos!: Table<any, string>;
  pedido_lineas!: Table<any, string>;
  // Inventarios / Fabricación (solo lectura en el cliente)
  bodegas!: Table<any, string>;
  existencias!: Table<any, string>;
  ordenes_fabricacion!: Table<any, string>;
  // Caja y Facturación
  cajas!: Table<any, string>;
  sesiones_caja!: Table<any, string>;
  movimientos_caja!: Table<any, string>;
  facturas!: Table<any, string>;
  // Infraestructura offline
  outbox!: Table<Operacion, string>;
  meta!: Table<{ clave: string; valor: unknown }, string>;

  constructor() {
    super('sierrainnova');
    this.version(1).stores({
      articulos: 'id, sku, nombre',
      clientes: 'id, razon_social, numero_documento',
      clientes_credito: 'id',
      pedidos: 'id, estado, cliente_id, creado_en',
      pedido_lineas: 'id, pedido_id',
      bodegas: 'id, codigo',
      existencias: 'id, [articulo_id+bodega_id]',
      ordenes_fabricacion: 'id, estado, pedido_linea_id',
      cajas: 'id',
      sesiones_caja: 'id, estado, usuario_id',
      movimientos_caja: 'id, sesion_id, creado_en',
      facturas: 'id, pedido_id, cliente_id, estado',
      outbox: 'idempotencyKey, estado, creadoEn',
      meta: 'clave',
    });
  }
}
export const db = new BdLocal();

// Correspondencia tabla del servidor -> tabla local
export const TABLAS_LOCALES: Record<string, keyof BdLocal & string> = {
  'catalogo.articulo': 'articulos',
  'catalogo.cliente': 'clientes',
  'pedidos.cliente': 'clientes_credito',
  'pedidos.pedido': 'pedidos',
  'pedidos.pedido_linea': 'pedido_lineas',
  'inventarios.bodega': 'bodegas',
  'inventarios.existencia': 'existencias',
  'fabricacion.orden_fabricacion': 'ordenes_fabricacion',
  'caja.caja': 'cajas',
  'caja.sesion_caja': 'sesiones_caja',
  'caja.movimiento_caja': 'movimientos_caja',
  'facturacion.factura': 'facturas',
};
```

### 10.4 Cliente HTTP

```ts
// src/offline/api.ts
import { supabase } from '@/auth/supabase';

export class ErrorHttp extends Error { constructor(public estado: number) { super(`HTTP ${estado}`); } }

export async function api<T = any>(ruta: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const empresaId = localStorage.getItem('empresaId') ?? '';
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1${ruta}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'X-Empresa-Id': empresaId,
      ...init.headers,
    },
  });
  if (!res.ok) throw new ErrorHttp(res.status);
  return res.json();
}
```

### 10.5 Escritura local + outbox (un repositorio por agregado)

```ts
// src/offline/repos/pedidos.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

export interface LineaBorrador {
  id: string; articuloId: string; descripcion: string; cantidad: number;
  precioUnitario: number; descuentoPct: number; ivaPct: number;
}
export interface BorradorPedido {
  id: string; clienteId: string; bodegaId: string;
  canal: 'MOSTRADOR' | 'TELEFONO'; condicionPago: 'CONTADO' | 'CREDITO';
  lineas: LineaBorrador[];
}

export const nuevoId = () => uuidv7();

export async function guardarBorrador(b: BorradorPedido) {
  const subtotal = b.lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario * (1 - l.descuentoPct / 100), 0);
  await db.transaction('rw', db.pedidos, db.pedido_lineas, db.outbox, async () => {
    await db.pedidos.put({
      id: b.id, cliente_id: b.clienteId, bodega_id: b.bodegaId, canal: b.canal, condicion_pago: b.condicionPago,
      estado: 'BORRADOR', total: subtotal, creado_en: new Date().toISOString(), _local: true,
    });
    await db.pedido_lineas.where('pedido_id').equals(b.id).delete();
    await db.pedido_lineas.bulkPut(b.lineas.map(l => ({
      id: l.id, pedido_id: b.id, articulo_id: l.articuloId, descripcion: l.descripcion,
      cantidad: l.cantidad, precio_unitario: l.precioUnitario, descuento_pct: l.descuentoPct, iva_pct: l.ivaPct,
      cantidad_reservada: 0, cantidad_a_fabricar: 0,
    })));
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'pedidos.pedido.guardar_borrador', datos: b,
      registroId: b.id, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
}

export async function confirmarPedido(pedidoId: string) {
  await db.transaction('rw', db.pedidos, db.outbox, async () => {
    await db.pedidos.update(pedidoId, { _confirmando: true });   // marca visual "pendiente de confirmar"
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'pedidos.pedido.confirmar', datos: { pedidoId },
      registroId: pedidoId, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
}
```

### 10.6 Motor de sincronización

```ts
// src/offline/motor-sync.ts
import { supabase } from '@/auth/supabase';
import { api, ErrorHttp } from './api';
import { db, TABLAS_LOCALES } from './db';
import { v4 as uuid } from 'uuid';

let enCurso = false;
let pendiente = false;

function dispositivoId(): string {
  let id = localStorage.getItem('dispositivoId');
  if (!id) { id = uuid(); localStorage.setItem('dispositivoId', id); }
  return id;
}

/** Punto de entrada único: se puede llamar muchas veces, se agrupan. */
export async function solicitarSync(): Promise<void> {
  if (!navigator.onLine) return;
  if (enCurso) { pendiente = true; return; }
  enCurso = true;
  try {
    do {
      pendiente = false;
      await push();
      await pull();
    } while (pendiente);
  } catch (e) {
    if (!(e instanceof ErrorHttp) || e.estado >= 500) console.warn('Sync pospuesta', e);
  } finally {
    enCurso = false;
  }
}

async function push() {
  for (;;) {
    const lote = (await db.outbox.where('estado').equals('pendiente').sortBy('creadoEn')).slice(0, 50);
    if (lote.length === 0) return;

    const { resultados } = await api<{ resultados: any[] }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        dispositivoId: dispositivoId(),
        operaciones: lote.map(o => ({ idempotencyKey: o.idempotencyKey, tipo: o.tipo, datos: o.datos, creadoEn: o.creadoEn })),
      }),
    });

    for (const r of resultados) {
      if (r.estado === 'OK') await db.outbox.delete(r.idempotencyKey);
      else await db.outbox.update(r.idempotencyKey, { estado: 'rechazada', error: r.mensaje });
    }
  }
}

async function pull() {
  let desde = Number((await db.meta.get('ultima_secuencia'))?.valor ?? 0);
  for (;;) {
    const r = await api<{ cambios: any[]; hasta: number; hayMas: boolean }>(`/sync/pull?desde=${desde}&limite=500`);
    await aplicarCambios(r.cambios, r.hasta);
    desde = r.hasta;
    if (!r.hayMas) return;
  }
}

async function aplicarCambios(cambios: any[], hasta: number) {
  // No pisar registros que tienen operaciones locales pendientes
  const pendientes = new Set((await db.outbox.where('estado').equals('pendiente').toArray()).map(o => o.registroId));

  await db.transaction('rw', [...db.tables], async () => {
    for (const c of cambios) {
      const nombre = TABLAS_LOCALES[c.tabla];
      if (!nombre || pendientes.has(c.registroId)) continue;
      const tabla = (db as any)[nombre];
      if (c.operacion === 'D') await tabla.delete(c.registroId);
      else await tabla.put(c.payload);             // el servidor es la fuente de verdad
    }
    await db.meta.put({ clave: 'ultima_secuencia', valor: hasta });
  });
}

/** Arranca disparadores: red, foco, temporizador, Realtime y Background Sync. */
export function iniciarMotor(empresaId: string): () => void {
  const lanzar = () => void solicitarSync();
  window.addEventListener('online', lanzar);
  const onVis = () => document.visibilityState === 'visible' && lanzar();
  document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(lanzar, 30_000);

  // Supabase Realtime: la tabla "sync.senal" avisa que hay cambios nuevos
  const canal = supabase
    .channel(`sync-${empresaId}`)
    .on('postgres_changes', { event: '*', schema: 'sync', table: 'senal', filter: `empresa_id=eq.${empresaId}` }, lanzar)
    .subscribe();

  // El Service Worker avisa cuando el navegador recupera conectividad (Background Sync)
  const onMsg = (e: MessageEvent) => e.data?.tipo === 'SYNC' && lanzar();
  navigator.serviceWorker?.addEventListener('message', onMsg);

  navigator.storage?.persist?.();      // pide que el navegador no borre los datos locales
  lanzar();

  return () => {
    window.removeEventListener('online', lanzar);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(timer);
    supabase.removeChannel(canal);
    navigator.serviceWorker?.removeEventListener('message', onMsg);
  };
}
```

```tsx
// src/offline/AutoSync.tsx
'use client';
import { useEffect } from 'react';
import { iniciarMotor } from './motor-sync';

export function AutoSync({ empresaId }: { empresaId: string }) {
  useEffect(() => iniciarMotor(empresaId), [empresaId]);
  return null;
}
```

### 10.7 Service Worker y PWA

```ts
// next.config.ts
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist({
  reactStrictMode: true,
  output: 'standalone',            // imagen Docker liviana
});
```

```ts
// src/sw.ts
import { defaultCache } from '@serwist/next/worker';
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,      // cachea el "app shell" (JS, CSS, páginas estáticas)
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Nunca cachear la API ni la autenticación: los datos viven en IndexedDB
    { matcher: ({ url }) => /^(api|auth)\.sierrainnova\.tech$/.test(url.hostname), handler: new NetworkOnly() },
    ...defaultCache,
  ],
  fallbacks: { entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }] },
});
serwist.addEventListeners();

// Background Sync: cuando vuelve la red, avisa a la app para sincronizar
(self as any).addEventListener('sync', (event: any) => {
  if (event.tag === 'sync-outbox') {
    event.waitUntil(self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ tipo: 'SYNC' }))));
  }
});
```

```json
// public/manifest.webmanifest
{
  "name": "Sierra Innova",
  "short_name": "SierraInnova",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

En `src/app/layout.tsx` agregar `export const metadata = { manifest: '/manifest.webmanifest' }`, y crear `src/app/offline/page.tsx` con un mensaje simple de "Sin conexión".

### 10.8 Ejemplo de pantalla (lee siempre de la base local)

```tsx
// src/features/pedidos/ListaPedidos.tsx
'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/offline/db';
import { confirmarPedido } from '@/offline/repos/pedidos';

const ETIQUETA: Record<string, string> = {
  BORRADOR: 'Borrador', PENDIENTE_APROBACION: 'Pendiente de aprobación del supervisor',
  CONFIRMADO: 'Confirmado', DESPACHADO: 'Despachado', CANCELADO: 'Cancelado', RECHAZADO: 'Rechazado',
};

export function ListaPedidos() {
  const pedidos = useLiveQuery(() => db.pedidos.orderBy('creado_en').reverse().limit(100).toArray(), []);
  const lineas = useLiveQuery(() => db.pedido_lineas.toArray(), [], []);
  const pendientes = useLiveQuery(() => db.outbox.where('estado').equals('pendiente').count(), [], 0);
  const rechazadas = useLiveQuery(() => db.outbox.where('estado').equals('rechazada').toArray(), [], []);

  // R2: resumen por pedido de lo reservado y lo que va a fabricación
  const resumen = (id: string) => {
    const ls = lineas.filter(l => l.pedido_id === id && !l.eliminado_en);
    return { reservado: ls.reduce((s, l) => s + Number(l.cantidad_reservada), 0),
             fabricar: ls.reduce((s, l) => s + Number(l.cantidad_a_fabricar), 0) };
  };

  return (
    <section className="space-y-3 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pedidos</h1>
        <span className="text-sm text-slate-500">{pendientes ? `${pendientes} por sincronizar` : 'Todo sincronizado'}</span>
      </header>

      {rechazadas.map(o => (
        <p key={o.idempotencyKey} className="rounded bg-red-50 p-2 text-sm text-red-700">Operación rechazada: {o.error}</p>
      ))}

      {pedidos?.map(p => {
        const r = resumen(p.id);
        return (
          <article key={p.id} className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="font-medium">{p.numero ?? 'Borrador'}</p>
              <p className="text-sm text-slate-500">
                {ETIQUETA[p.estado] ?? p.estado}{p._confirmando ? ' · confirmando…' : ''}
                {p.estado === 'CONFIRMADO' && ` · ${r.reservado} reservado${r.fabricar ? ` · ${r.fabricar} en fabricación` : ''}`}
                {p.motivo_rechazo ? ` · ${p.motivo_rechazo}` : ''}
              </p>
            </div>
            {p.estado === 'BORRADOR' && !p._confirmando && (
              <button className="rounded-lg bg-emerald-600 px-3 py-1 text-white" onClick={() => confirmarPedido(p.id)}>
                Confirmar
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
```

### 10.9 Reglas de oro del cliente Offline-First

- **Nunca** mostrar spinners bloqueantes por la red; mostrar el estado de sincronización (como arriba).
- **IDs en el cliente** (`uuidv7`) para crear registros relacionados (pedido + líneas) sin conexión.
- **Precios, impuestos y stock mostrados** son una copia local; el servidor recalcula y valida al confirmar.
- Mostrar al usuario las **operaciones rechazadas** con acción clara (corregir / descartar).
- Migraciones de Dexie: aumentar `this.version(n)` y definir `upgrade()` cuando cambie el esquema local.
- Limitar lo que se descarga por rol y por empresa (ver `TABLAS_POR_ROL`) para respetar el espacio del dispositivo.

### 10.10 Caja offline (cobros en efectivo)

```ts
// src/offline/repos/caja.ts
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db';
import { solicitarSync } from '../motor-sync';

/** Cobro en efectivo/transferencia dentro de una sesión YA abierta (abrirla exige conexión: R8). */
export async function registrarCobroEfectivo(p: { sesionId: string; valor: number; pedidoId?: string; facturaId?: string }) {
  const sesion = await db.sesiones_caja.get(p.sesionId);
  if (!sesion || sesion.estado !== 'ABIERTA') throw new Error('No hay una sesión de caja abierta en este dispositivo');

  const id = uuidv7();
  await db.transaction('rw', db.movimientos_caja, db.outbox, async () => {
    await db.movimientos_caja.put({                       // R9: solo se inserta, nunca se edita ni se borra
      id, sesion_id: p.sesionId, tipo: 'COBRO', sentido: 'ENTRADA', medio_pago: 'EFECTIVO',
      valor: p.valor, pedido_id: p.pedidoId ?? null, factura_id: p.facturaId ?? null,
      creado_en: new Date().toISOString(), _pendiente: true,
    });
    await db.outbox.add({
      idempotencyKey: uuidv7(), tipo: 'caja.cobro.registrar',
      datos: { id, sesionId: p.sesionId, medioPago: 'EFECTIVO', valor: p.valor, pedidoId: p.pedidoId, facturaId: p.facturaId },
      registroId: id, creadoEn: new Date().toISOString(), estado: 'pendiente',
    });
  });
  solicitarSync();
  return id;
}
// Pagos con TARJETA: NO se encolan. Se llama en línea a la pasarela, se obtiene el token/autorización y
// solo entonces se envía el cobro (R10). Una corrección es un REVERSO en línea (R9), nunca una edición.
```

---

## 11. Servicio de Reportes en Python

Servicio **de solo lectura** (FastAPI) para reportes pesados y exportes (Excel/PDF). Se conecta con un **rol de base de datos de solo lectura**.

### 11.1 Rol de solo lectura

```sql
-- db/scripts/100_rol_reportes.sql
CREATE ROLE reportes_ro LOGIN PASSWORD 'CAMBIAR_ESTA_CLAVE';
GRANT USAGE ON SCHEMA seguridad, catalogo, pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho TO reportes_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA seguridad, catalogo, pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho TO reportes_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA pedidos, inventarios, fabricacion, facturacion, caja, compras, despacho, catalogo
  GRANT SELECT ON TABLES TO reportes_ro;
-- Las políticas RLS de la sección 6.13 son para el rol "authenticated". Este rol de servicio las omite
-- (el filtro por empresa se aplica siempre en las consultas):
ALTER ROLE reportes_ro BYPASSRLS;
```

### 11.2 Aplicación FastAPI

```text
apps/reportes-py/
├── requirements.txt
├── Dockerfile
└── app/
    ├── main.py
    ├── seguridad.py
    └── consultas.py
```

```text
# requirements.txt
fastapi
uvicorn[standard]
psycopg[binary,pool]
PyJWT[crypto]
pandas
openpyxl
```

```python
# app/seguridad.py
import os
import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException

_jwks = PyJWKClient(os.environ["SUPABASE_JWKS_URL"])

def usuario_actual(authorization: str = Header(...)) -> str:
    """Valida el JWT (OAuth 2.0) emitido por Supabase Auth y devuelve el id del usuario."""
    token = authorization.removeprefix("Bearer ").strip()
    try:
        clave = _jwks.get_signing_key_from_jwt(token).key
        datos = jwt.decode(
            token, clave, algorithms=["ES256", "RS256"],
            audience=os.environ["JWT_AUDIENCE"], issuer=os.environ["JWT_ISSUER"],
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")
    return datos["sub"]
```

```python
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
```

```dockerfile
# apps/reportes-py/Dockerfile
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Nginx expone este servicio en `https://api.sierrainnova.tech/reportes/` (ver paso 14).

---

## 12. Comunicación entre módulos y eventos

| Evento (publicador → suscriptor) | Acción del suscriptor | Regla | Idempotencia |
|---|---|---|---|
| `catalogo.ClienteCreado / Actualizado` → **Pedidos** | Crea/actualiza `pedidos.cliente` | — | `ON CONFLICT (id)` |
| `pedidos.PedidoRequiereAprobacion` → (UI / notificación) | Avisa al supervisor de ventas | R13 | — |
| `pedidos.PedidoConfirmado` → **Fabricación** | Crea una OF por cada línea con faltante | R1, R4 | `uq_r4_clave_origen` |
| `pedidos.PedidoCancelado` → **Inventarios** | Libera reservas activas | R3 | Estado de la reserva |
| `fabricacion.OrdenFabricacionTerminada` → **Inventarios** | Entrada al kardex y reserva para la línea | R5 | Clave de kardex `of:<id>:entrada` |
| `inventarios.StockReservadoPorProduccion` → **Pedidos** | Actualiza `cantidad_reservada` / `cantidad_a_fabricar` | R2 | Valor absoluto (no incremental) |
| `compras.RecepcionRegistrada` → **Inventarios** | Entrada al kardex por línea | R5 | Clave `recepcion-linea:<id>` |
| `caja.CobroRegistrado` → **Facturación** | Crea `pago_factura` y recalcula el saldo | R7 | `UNIQUE(movimiento_caja_id)` |
| `caja.MovimientoReversado` → **Facturación** | Marca el pago como `REVERSADO` | R9 | Comparación de estado |
| `facturacion.FacturaEmitida` → adaptador DIAN / **Pedidos** | Transmite el documento; marca el pedido facturado | R14 | `cufe` / `factura_id` |
| `facturacion.FacturaAnulada` → (Pedidos) | Libera crédito y deja el pedido sin factura vigente | R6 | Estado |
| `despacho.DespachoRealizado` → **Pedidos** | Pedido pasa a `DESPACHADO` si el despacho es completo | R12 | `WHERE estado='CONFIRMADO'` |

Llamadas **síncronas** permitidas (mismo proceso, misma transacción) y solo por la API pública del módulo:

| Quién llama | A qué API | Para qué | Regla |
|---|---|---|---|
| Pedidos | `InventariosApi.reservar()` | Reservar stock al confirmar | R2, R3 |
| Despacho | `InventariosApi.reservasActivas()` / `consumirReservas()` | Despachar solo con reserva activa | R12 |
| Facturación | `PedidosApi.obtenerParaFacturar()` | Leer líneas y totales del pedido | — |

**Contratos de eventos** compartidos (opcional pero recomendado) en `packages/contratos`:

```ts
// packages/contratos/src/eventos.ts
import { z } from 'zod';

export const PedidoConfirmadoV1 = z.object({
  pedidoId: z.string().uuid(),
  numero: z.string(),
  clienteId: z.string().uuid(),
  bodegaId: z.string().uuid(),
  condicionPago: z.enum(['CONTADO', 'CREDITO']),
  total: z.number(),
  lineas: z.array(z.object({
    pedidoLineaId: z.string().uuid(),
    articuloId: z.string().uuid(),
    cantidad: z.number().positive(),
    reservada: z.number().min(0),
    aFabricar: z.number().min(0),          // > 0 => Fabricación crea OF (R1)
  })),
});
export type PedidoConfirmadoV1 = z.infer<typeof PedidoConfirmadoV1>;
```

Los suscriptores validan el `payload` con el esquema antes de procesarlo. Si un contrato cambia, se publica `V2` y se mantienen ambos mientras haya eventos pendientes.

**Evolución futura:** como los módulos solo se hablan por eventos y API públicas, extraer uno (por ejemplo Facturación o Fabricación) a un servicio independiente solo exige reemplazar el `BusEventos` interno por un broker (Redis Streams / RabbitMQ), convertir sus llamadas síncronas en HTTP/eventos y mover su esquema a su propia base `svc_*`.

---
## 13. Pruebas

### 13.1 Dominio (unitarias, sin base de datos)

```ts
// src/modulos/pedidos/dominio/pedido.spec.ts
import { Dinero } from '../../../kernel/dinero';
import { ClienteCredito } from './cliente-credito';
import { Pedido } from './pedido';

const id = () => crypto.randomUUID();
const linea = (cantidad: number) => ({
  id: id(), articuloId: id(), descripcion: 'Mesa de roble', cantidad,
  precioUnitario: Dinero.de(10000), descuentoPct: 10, ivaPct: 19,
});
const nuevo = (cond: 'CONTADO' | 'CREDITO', lineas = [linea(2)]) => {
  const r = Pedido.crearBorrador({ id: id(), empresaId: id(), clienteId: id(), vendedorId: id(), bodegaId: id(),
                                   canal: 'MOSTRADOR', condicionPago: cond, lineas });
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};
const cliente = (limite: number, usado = 0, bloqueado = false) => new ClienteCredito(id(), id(), limite, usado, bloqueado);

describe('Pedido', () => {
  it('calcula subtotal, IVA y total', () => {
    const p = nuevo('CONTADO');
    expect(p.subtotal().valor).toBe(18000);   // 2 x 10000 - 10%
    expect(p.total().valor).toBe(21420);      // + 19%
  });

  it('R1/R2: mezcla de líneas - reserva lo disponible y manda el faltante a fabricar', () => {
    const p = nuevo('CONTADO', [linea(10), linea(5)]);
    const [a, b] = p.lineas;
    expect(p.confirmar('PED-1', [{ lineaId: a.id, reservada: 10 }, { lineaId: b.id, reservada: 2 }]).ok).toBe(true);
    const [la, lb] = p.lineas;
    expect([la.cantidadReservada, la.cantidadAFabricar]).toEqual([10, 0]);   // todo con stock
    expect([lb.cantidadReservada, lb.cantidadAFabricar]).toEqual([2, 3]);    // 3 a fabricar
    const evento = p.extraerEventos().find(e => e.tipo === 'pedidos.PedidoConfirmado')!;
    expect((evento.datos.lineas as any[]).filter(l => l.aFabricar > 0)).toHaveLength(1);
  });

  it('R1: sin nada de stock, toda la línea va a fabricación', () => {
    const p = nuevo('CONTADO', [linea(4)]);
    p.confirmar('PED-1', []);
    expect(p.lineas[0].cantidadAFabricar).toBe(4);
  });

  it('R13: pedido a crédito que excede el límite requiere aprobación', () => {
    const p = nuevo('CREDITO');                                    // total 21 420
    expect(p.evaluarCredito(cliente(20000))).toBe('REQUIERE_APROBACION');
    expect(p.evaluarCredito(cliente(30000, 10000))).toBe('REQUIERE_APROBACION');   // disponible 20 000
    expect(p.evaluarCredito(cliente(30000))).toBe('OK');
  });

  it('R13: cliente bloqueado no puede comprar a crédito; contado no se evalúa', () => {
    expect(nuevo('CREDITO').evaluarCredito(cliente(1_000_000, 0, true))).toBe('BLOQUEADO');
    expect(nuevo('CONTADO').evaluarCredito(cliente(0))).toBe('OK');
  });

  it('un pedido pendiente de aprobación se puede confirmar luego (aprobación)', () => {
    const p = nuevo('CREDITO');
    expect(p.enviarAAprobacion(1420).ok).toBe(true);
    expect(p.estado).toBe('PENDIENTE_APROBACION');
    expect(p.confirmar('PED-9', []).ok).toBe(true);
  });

  it('no permite confirmar dos veces ni un pedido sin líneas', () => {
    const p = nuevo('CONTADO');
    p.confirmar('PED-1', []);
    expect(p.confirmar('PED-2', []).ok).toBe(false);
    const r = Pedido.crearBorrador({ id: id(), empresaId: id(), clienteId: id(), vendedorId: id(), bodegaId: id(),
                                     canal: 'MOSTRADOR', condicionPago: 'CONTADO', lineas: [] });
    if (r.ok) expect(r.valor.confirmar('PED-3', []).ok).toBe(false);
  });
});
```

```ts
// src/modulos/caja/dominio/referencia-pago.spec.ts   (R10)
import { ReferenciaPago } from './referencia-pago';

describe('ReferenciaPago (R10)', () => {
  it('rechaza un número de tarjeta válido (Luhn), con o sin separadores', () => {
    expect(ReferenciaPago.crear('TARJETA', '4111111111111111').ok).toBe(false);
    expect(ReferenciaPago.crear('TARJETA', '4111 1111 1111 1111').ok).toBe(false);
  });
  it('exige token o autorización en pagos con tarjeta', () => {
    expect(ReferenciaPago.crear('TARJETA', '').ok).toBe(false);
    expect(ReferenciaPago.crear('TARJETA', 'tok_8f3a91c2').ok).toBe(true);
  });
  it('el efectivo no requiere referencia', () => {
    expect(ReferenciaPago.crear('EFECTIVO', undefined).ok).toBe(true);
  });
});
```

### 13.2 Integración (API + PostgreSQL real) — una prueba por regla

Usar **Testcontainers** (`@testcontainers/postgresql`), ejecutar `db/scripts/*.sql` y verificar. Las reglas R3, R5, R8, R9, R10 ya tienen prueba a nivel SQL en `db/tests/reglas.sql`; aquí se prueban de extremo a extremo:

| Regla | Prueba de integración |
|---|---|
| **R1** | Confirmar un pedido con 10 pedidos y 6 disponibles → `cantidad_reservada = 6`, `cantidad_a_fabricar = 4` y existe **1 OF** por 4 unidades |
| **R2** | Pedido con 2 líneas (una con stock, otra sin stock) → una línea `RESERVADO`, otra `EN_FABRICACION`; solo se crea OF para la segunda |
| **R3** | Dos confirmaciones concurrentes sobre el último artículo → solo una reserva; `cantidad_reservada <= cantidad_fisica` siempre |
| **R4** | Entregar el evento `PedidoConfirmado` **dos veces** → sigue existiendo **una sola** OF por línea |
| **R5** | Tras una secuencia de reservas, recepciones y despachos, `inventarios.v_inconsistencias_kardex` devuelve **0 filas** |
| **R6** | `DELETE` sobre `facturacion.factura` falla; anular crea nota de crédito y deja la factura `ANULADA` con saldo 0 |
| **R7** | Dos pagos parciales dejan saldo = total − pagos y estado `PAGADA_PARCIAL`; un pago mayor al saldo es rechazado; reversar un pago restaura el saldo |
| **R8** | Abrir dos sesiones para la misma caja, o dos para el mismo usuario → `R8_SESION_ABIERTA` |
| **R9** | `UPDATE`/`DELETE` de un movimiento falla; un reverso con valor distinto falla; un movimiento no puede reversarse dos veces |
| **R10** | Cobro con tarjeta sin referencia o con referencia de 16 dígitos → rechazado |
| **R11** | Cerrar una OC con líneas sin recibir → error; recibir todo y cerrar → éxito |
| **R12** | Despachar sin reservas activas, o con reservas ya consumidas → `R12_SIN_RESERVA_ACTIVA` y el kardex no cambia |
| **R13** | Pedido a crédito sobre el límite → `PENDIENTE_APROBACION` y **sin** reservas; tras `aprobar` → `CONFIRMADO`. Dos pedidos concurrentes del mismo cliente no superan el límite combinado |
| **R14** | 50 emisiones concurrentes → numeración 1..50 **sin repetidos ni saltos**; una emisión que falla a mitad (rollback) no consume número |

Además: `POST /sync/push` con la misma `idempotencyKey` dos veces se procesa **una sola vez**, y `GET /sync/pull` devuelve únicamente las tablas permitidas a la unión de roles del usuario y solo de su empresa.

### 13.3 Extremo a extremo Offline (Playwright)

```ts
// apps/web/e2e/offline.spec.ts
import { test, expect } from '@playwright/test';

test('crea un pedido sin conexión y se sincroniza al reconectar', async ({ page, context }) => {
  await page.goto('/pedidos');
  await context.setOffline(true);

  await page.getByRole('button', { name: 'Nuevo pedido' }).click();
  // ... diligenciar cliente y líneas ...
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('1 por sincronizar')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Todo sincronizado')).toBeVisible({ timeout: 15_000 });
});
```

### 13.4 Arquitectura como prueba

`pnpm lint:arq` (dependency-cruiser) falla el *pipeline* si el dominio importa infraestructura o si un módulo accede a las tripas de otro.

---
## 14. Despliegue en VPS Ubuntu (sierrainnova.tech)

### 14.1 Topología

```
Internet ──► Nginx (host, 80/443, TLS Let's Encrypt)
               ├─ app.sierrainnova.tech   ──► Next.js        (127.0.0.1:3000)
               ├─ api.sierrainnova.tech   ──► NestJS         (127.0.0.1:3001)
               │    └─ /reportes/         ──► FastAPI        (127.0.0.1:8000)
               └─ auth.sierrainnova.tech  ──► Supabase Kong  (127.0.0.1:8001)  [Auth + Realtime]
                                              └─► PostgreSQL (solo red interna Docker)
```

- **PostgreSQL nunca se expone a Internet.** Solo se accede desde la red interna de Docker o por túnel SSH.
- Se recomienda un VPS con **mínimo 4 vCPU y 8 GB de RAM** si se autoalojan Supabase + app + reportes. Con menos recursos, usa **Supabase Cloud** para Auth/Realtime y deja en el VPS solo PostgreSQL + app (ajustando `SUPABASE_*` y `DATABASE_URL`).

### 14.2 DNS

Crear registros **A** apuntando a la IP del VPS:

| Nombre | Tipo | Valor |
|---|---|---|
| `sierrainnova.tech` | A | `IP_DEL_VPS` |
| `www` | A | `IP_DEL_VPS` |
| `app` | A | `IP_DEL_VPS` |
| `api` | A | `IP_DEL_VPS` |
| `auth` | A | `IP_DEL_VPS` |

### 14.3 Preparar el servidor

```bash
# Acceso inicial como root
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Endurecer SSH: solo llaves, sin root
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Actualizaciones y utilidades
apt update && apt -y upgrade
apt -y install ufw fail2ban nginx certbot python3-certbot-nginx git curl unattended-upgrades

# Firewall
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 'Nginx Full'
ufw enable

# Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

### 14.4 Supabase autoalojado (PostgreSQL + Auth + Realtime)

```bash
sudo -u deploy -i
mkdir -p ~/plataforma && cd ~/plataforma
git clone --depth 1 https://github.com/supabase/supabase
cp -r supabase/docker ./supabase-docker && cd supabase-docker
cp .env.example .env
# Editar .env: POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY (generarlas con el script
# de la documentación oficial), SITE_URL=https://app.sierrainnova.tech,
# API_EXTERNAL_URL=https://auth.sierrainnova.tech, SUPABASE_PUBLIC_URL=https://auth.sierrainnova.tech
docker compose pull && docker compose up -d
```

> Cambiar el puerto publicado de Kong a `127.0.0.1:8001:8000` para que solo Nginx lo alcance, y **no publicar** el puerto 5432 del pooler/DB hacia el exterior.
> Seguir la guía oficial de *self-hosting* de Supabase para generar claves y habilitar el proveedor de Google.

El modelo de datos (`db/scripts/*.sql`) se carga automáticamente en el primer despliegue con `infra/scripts/deploy.sh` (ver 15.1), que registra cada script aplicado en `nucleo.migracion`.

### 14.5 Contenedores de la aplicación

```yaml
# infra/docker-compose.yml
services:
  api:
    build: { context: .., dockerfile: apps/api/Dockerfile }
    env_file: ./.env.api
    restart: unless-stopped
    ports: ["127.0.0.1:3001:3001"]
    networks: [supabase]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/v1/salud"]
      interval: 30s
      timeout: 5s
      retries: 3

  web:
    build:
      context: ..
      dockerfile: apps/web/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: https://api.sierrainnova.tech
        NEXT_PUBLIC_SUPABASE_URL: https://auth.sierrainnova.tech
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
    restart: unless-stopped
    ports: ["127.0.0.1:3000:3000"]

  reportes:
    build: { context: ../apps/reportes-py }
    env_file: ./.env.reportes
    restart: unless-stopped
    ports: ["127.0.0.1:8000:8000"]
    networks: [supabase]

networks:
  supabase:
    external: true
    name: supabase-docker_default      # nombre de la red creada por el compose de Supabase (verificar con: docker network ls)
```

`infra/.env.api`:

```env
NODE_ENV=production
PORT=3001
WEB_ORIGIN=https://app.sierrainnova.tech
DATABASE_URL=postgresql://postgres:<CLAVE>@db:5432/postgres
SUPABASE_JWKS_URL=https://auth.sierrainnova.tech/auth/v1/.well-known/jwks.json
JWT_ISSUER=https://auth.sierrainnova.tech/auth/v1
JWT_AUDIENCE=authenticated
```

`infra/.env.reportes`:

```env
DATABASE_URL_RO=postgresql://reportes_ro:<CLAVE>@db:5432/postgres
SUPABASE_JWKS_URL=https://auth.sierrainnova.tech/auth/v1/.well-known/jwks.json
JWT_ISSUER=https://auth.sierrainnova.tech/auth/v1
JWT_AUDIENCE=authenticated
```

Endpoint de salud en NestJS (agregar a cualquier controller público):

```ts
@Controller() export class SaludController { @Get('salud') salud() { return { estado: 'ok' }; } }
```

**Dockerfile de la API** (`apps/api/Dockerfile`):

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contratos/package.json packages/contratos/
RUN pnpm install --frozen-lockfile --filter api...
COPY . .
RUN pnpm --filter api build && pnpm --filter api deploy --prod /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

**Dockerfile del frontend** (`apps/web/Dockerfile`):

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
COPY . .
RUN pnpm install --frozen-lockfile --filter web... && pnpm --filter web build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# next.config: output 'standalone' (en monorepo la ruta incluye apps/web)
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

### 14.6 Nginx + HTTPS

```bash
# 1) Certificado único para todos los subdominios
sudo certbot certonly --nginx \
  -d sierrainnova.tech -d www.sierrainnova.tech \
  -d app.sierrainnova.tech -d api.sierrainnova.tech -d auth.sierrainnova.tech \
  --agree-tos -m admin@sierrainnova.tech
```

`/etc/nginx/sites-available/sierrainnova.conf`:

```nginx
limit_req_zone $binary_remote_addr zone=zona_auth:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=zona_api:10m  rate=30r/s;

map $http_upgrade $conexion_upgrade { default upgrade; '' close; }

# --- HTTP -> HTTPS ---
server {
  listen 80;
  server_name sierrainnova.tech www.sierrainnova.tech app.sierrainnova.tech api.sierrainnova.tech auth.sierrainnova.tech;
  return 301 https://$host$request_uri;
}

# --- Dominio raíz -> aplicación ---
server {
  listen 443 ssl http2;
  server_name sierrainnova.tech www.sierrainnova.tech;
  ssl_certificate     /etc/letsencrypt/live/sierrainnova.tech/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sierrainnova.tech/privkey.pem;
  return 301 https://app.sierrainnova.tech$request_uri;
}

# --- Aplicación web (PWA) ---
server {
  listen 443 ssl http2;
  server_name app.sierrainnova.tech;
  ssl_certificate     /etc/letsencrypt/live/sierrainnova.tech/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sierrainnova.tech/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  # El Service Worker nunca debe quedar cacheado por el navegador
  location = /sw.js { proxy_pass http://127.0.0.1:3000; add_header Cache-Control "no-cache, no-store, must-revalidate"; }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# --- API REST (API Gateway) ---
server {
  listen 443 ssl http2;
  server_name api.sierrainnova.tech;
  ssl_certificate     /etc/letsencrypt/live/sierrainnova.tech/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sierrainnova.tech/privkey.pem;
  client_max_body_size 5m;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  location /reportes/ {
    limit_req zone=zona_api burst=20 nodelay;
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
  }
  location / {
    limit_req zone=zona_api burst=60 nodelay;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# --- Autenticación (Supabase Auth) + Realtime (WebSocket) ---
server {
  listen 443 ssl http2;
  server_name auth.sierrainnova.tech;
  ssl_certificate     /etc/letsencrypt/live/sierrainnova.tech/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sierrainnova.tech/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  location /auth/ {
    limit_req zone=zona_auth burst=20 nodelay;
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /realtime/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $conexion_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sierrainnova.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run        # verifica la renovación automática
```

### 14.7 Primera puesta en marcha

```bash
cd ~/plataforma && git clone <URL_REPOSITORIO> app && cd app/infra
docker compose --env-file .env.web up -d --build     # .env.web contiene SUPABASE_ANON_KEY
docker compose ps
curl https://api.sierrainnova.tech/v1/salud
```

---

## 15. CI/CD, backups y observabilidad

### 15.1 Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci-cd.yml
name: ci-cd
on:
  push: { branches: [main] }
  pull_request:

jobs:
  calidad:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint:arq            # reglas de arquitectura
      - run: pnpm -r lint
      - run: pnpm -r test
      - run: pnpm -r build

  desplegar:
    needs: calidad
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: bash ~/plataforma/app/infra/scripts/deploy.sh
```

```bash
#!/usr/bin/env bash
# infra/scripts/deploy.sh
set -euo pipefail
cd ~/plataforma/app
git pull --ff-only

# Migraciones: aplica solo los scripts que aún no están registrados en nucleo.migracion
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"
$PSQL -q -c "CREATE SCHEMA IF NOT EXISTS nucleo; CREATE TABLE IF NOT EXISTS nucleo.migracion (archivo text PRIMARY KEY, aplicada_en timestamptz DEFAULT now());"
for f in db/scripts/*.sql; do
  nombre=$(basename "$f")
  existe=$($PSQL -Atc "SELECT 1 FROM nucleo.migracion WHERE archivo='$nombre'")
  if [ -z "$existe" ]; then
    echo ">> Aplicando $nombre"
    $PSQL < "$f"
    $PSQL -q -c "INSERT INTO nucleo.migracion(archivo) VALUES ('$nombre')"
  fi
done

cd infra
docker compose --env-file .env.web up -d --build
docker image prune -f
```

> Para entornos con más de un desarrollador, reemplazar este bucle por una herramienta de migraciones con control de versiones (`dbmate`, `node-pg-migrate` o Flyway). El script anterior es solo un punto de partida.

### 15.2 Copias de seguridad

```bash
#!/usr/bin/env bash
# infra/scripts/backup.sh   (cron: 0 2 * * *  /home/deploy/plataforma/app/infra/scripts/backup.sh)
set -euo pipefail
DESTINO=/home/deploy/backups
FECHA=$(date +%F_%H%M)
mkdir -p "$DESTINO"
docker exec supabase-db pg_dump -U postgres -d postgres -Fc --exclude-schema=realtime > "$DESTINO/bd_$FECHA.dump"
find "$DESTINO" -name 'bd_*.dump' -mtime +14 -delete          # retención 14 días
# Copia externa (ejemplo con rclone configurado hacia un almacenamiento de objetos):
# rclone copy "$DESTINO/bd_$FECHA.dump" remoto:sierrainnova-backups/
```

**Probar la restauración al menos una vez al mes:**

```bash
docker exec -i supabase-db pg_restore -U postgres -d postgres_prueba --clean --if-exists < bd_FECHA.dump
```

### 15.3 Observabilidad

| Aspecto | Herramienta sugerida |
|---|---|
| Logs estructurados | `pino` (NestJS) → `docker logs` / Loki + Grafana |
| Errores | Sentry (web + api + python) |
| Disponibilidad | Uptime Kuma contra `/v1/salud` y `/reportes/salud` |
| Métricas de BD | `pg_stat_statements`, alerta de disco > 80 % |
| Sincronización | Panel con: operaciones `rechazada` por día, latencia de push/pull, eventos de outbox con `intentos >= 10` |

Consulta útil para monitorear el outbox:

```sql
SELECT tipo, count(*) AS pendientes, max(intentos) AS max_intentos
  FROM nucleo.evento_outbox WHERE procesado_en IS NULL GROUP BY tipo;
```

---

## 16. Hoja de ruta por fases

| Fase | Duración orientativa | Entregables |
|---|---|---|
| **0. Fundamentos** | 1 semana | Monorepo, CI, reglas de arquitectura, VPS con Nginx/HTTPS, Supabase, scripts `000–005`, `db/tests/reglas.sql` en CI |
| **1. Seguridad y datos maestros** | 2 semanas | OAuth 2.0 + PKCE, guard con múltiples roles, los 9 roles/permisos, `catalogo` (artículos y clientes), auditoría |
| **2. Offline base** | 2 semanas | Dexie, PWA/Service Worker, outbox, motor push/pull, Realtime, catálogos sincronizados |
| **3. Inventarios + Pedidos** | 3 semanas | Kardex y reservas (R3, R5, R12), pedidos con líneas mixtas (R2), control de crédito y aprobación del supervisor (R13) |
| **4. Fabricación** | 2 semanas | Generación de OF por faltante (R1, R4), liberar/programar/reportar, entrada de producto terminado y re-reserva |
| **5. Caja** | 2 semanas | Sesiones (R8), cobros offline en efectivo, reversos (R9), referencia sin datos de tarjeta (R10), arqueos |
| **6. Facturación** | 3 semanas | Series y numeración sin saltos (R14), emisión, pagos y saldo (R7), notas de crédito (R6), adaptador DIAN |
| **7. Compras y Despacho** | 3 semanas | Proveedores, OC y aprobación, recepción y cierre (R11), despacho con reserva activa (R12), evidencias de entrega |
| **8. E-commerce** | 2 semanas | `/tienda`: catálogo publicado, carrito, checkout con pasarela tokenizada, seguimiento |
| **9. Reportes** | 2 semanas | Servicio Python, cartera vencida, ventas por vendedor, producción pendiente, exportes |
| **10. Endurecimiento** | 2 semanas | Pruebas de concurrencia de R3/R13/R14, caos de red, seguridad, backups verificados, runbooks |

Los tiempos son referencias para un equipo pequeño (2–3 desarrolladores) y dependen del alcance real.

---

## 17. Checklist final

**Arquitectura**
- [ ] Cada módulo tiene sus 4 capas y solo expone `index.ts` (por ejemplo `InventariosApi`, `PedidosApi`)
- [ ] `pnpm lint:arq` pasa en CI
- [ ] Sin llaves foráneas entre esquemas
- [ ] Comunicación por eventos; llamadas síncronas solo por API pública (reservar, consumir reservas, leer pedido a facturar)

**Reglas de negocio (cada una con su prueba)**
- [ ] R1, R2 — faltante genera OF; líneas mixtas con `cantidad_reservada` y `cantidad_a_fabricar`
- [ ] R3 — `CHECK` de reservado ≤ físico + reserva con `FOR UPDATE`
- [ ] R4 — `clave_origen` única; reintento de evento no duplica OF
- [ ] R5 — existencias solo cambian por el kardex; `v_inconsistencias_kardex` vacía
- [ ] R6 — facturas no se borran; anulación solo con nota de crédito
- [ ] R7 — saldo = total − pagos aplicados (trigger), sin sobrepagos
- [ ] R8 — una sesión abierta por caja y por usuario
- [ ] R9 — movimientos de caja inmutables; corrección con reverso exacto
- [ ] R10 — sin datos de tarjeta (CHECK + Luhn en dominio)
- [ ] R11 — OC no se cierra sin recepción completa
- [ ] R12 — despacho solo consumiendo reservas `ACTIVA`
- [ ] R13 — pedido sobre el límite queda `PENDIENTE_APROBACION`; solo el supervisor aprueba
- [ ] R14 — numeración fiscal sin saltos ni duplicados bajo concurrencia

**Actores y seguridad**
- [ ] Los 9 roles con sus permisos cargados (`090_semillas.sql`)
- [ ] Cliente web solo ve sus propios pedidos (`cliente_id` del token, nunca del cuerpo)
- [ ] OAuth 2.0 Authorization Code + PKCE; `redirect_uri` exactas
- [ ] La API valida firma, `iss`, `aud` y expiración del JWT
- [ ] RBAC por empresa en cada endpoint y comando de sync
- [ ] PostgreSQL sin puertos públicos; `ufw` y `fail2ban` activos; `TRUNCATE` revocado al rol de la app
- [ ] Secretos fuera del repositorio; cabeceras de seguridad y *rate limiting* en Nginx

**Datos y Offline-First**
- [ ] Scripts `000–100` ejecutan en limpio sobre una BD vacía y `db/tests/reglas.sql` pasa
- [ ] La app abre y opera sin red; todas las escrituras pasan por el outbox con `idempotencyKey`
- [ ] IDs generados en el cliente (UUID v7); existencias y saldos solo de lectura
- [ ] Operaciones rechazadas visibles con el código de la regla y acción clara
- [ ] Prueba E2E "crear pedido y cobrar en efectivo offline → reconectar → sincronizado"
- [ ] Backups diarios + restauración probada

**Operación**
- [ ] Despliegue automático por CI/CD
- [ ] Monitoreo de disponibilidad, errores, outbox y operaciones rechazadas por regla
- [ ] Runbooks: restaurar BD, rotar claves, reprocesar eventos, reabrir una serie fiscal

---

### Notas finales y puntos a validar con el negocio

1. **Alcance del offline por rol:** definir qué roles operan sin red (vendedor, bodeguero, cajero) y cuánta información descarga cada uno.
2. **Artículos no fabricables (R1):** definir qué ocurre si falta stock de un artículo que no se fabrica (pedido pendiente, generar OC, rechazar la línea).
3. **Crédito (R13):** definir cuándo se **libera** el crédito consumido (al pagar la factura, al anular, al cancelar el pedido) y quién puede modificar `limite_credito`.
4. **Facturación electrónica (R14):** confirmar el proveedor tecnológico y si se requiere factura inmediata sin conexión (rangos reservados por terminal).
5. **Pagos con tarjeta (R10):** elegir la pasarela; el sistema solo guarda token y código de autorización.
6. **Política de conflictos** para catálogos (última escritura gana vs. revisión manual).
7. **Volumen esperado** (documentos/día, usuarios concurrentes) para validar el VPS y el uso del bloqueo consultivo en `sync.fn_registrar_cambio`.
8. **Versiones:** fijar versiones exactas en `pnpm-lock.yaml` y revisar la documentación vigente de Next.js, Serwist, Supabase y NestJS al iniciar, ya que sus APIs evolucionan con rapidez.
