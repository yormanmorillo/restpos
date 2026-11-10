# Casa Roble POS

Punto de venta táctil para restaurantes, pensado para tomar pedidos y cobrar en horas pico con el mínimo de toques. Frontend en **Next.js/React**, API en **Express** y persistencia local en **SQLite** (sin servicios externos ni infraestructura adicional).

![Pantalla de pedido del POS](docs/captura-pos.png)

## Funcionalidad

- **Salón táctil:** 8 mesas de ejemplo con estado libre/ocupada, total, número de artículos y tiempo de apertura.
- **Pedidos para llevar:** creación, reanudación y cobro sin asociar mesa.
- **Armado rápido:** catálogo por categorías, búsqueda, alta de productos con un toque, cantidades, eliminación y notas por producto ("sin cebolla").
- **Cobro:** subtotal, impuesto, descuentos por porcentaje o monto, propina por porcentaje o monto, efectivo/tarjeta/otro y cálculo de cambio.
- **Ticket:** recibo imprimible de 80 mm con desglose, forma de pago, efectivo recibido y cambio.
- **Historial y cierre del día:** ventas, tickets, ticket promedio, propinas, desglose por método de pago y productos más vendidos.
- **Administración:** alta, edición y desactivación de productos y categorías.
- **Datos persistentes:** SQLite en archivo; los datos sobreviven reinicios.
- **Validación en dos capas:** formularios y API validan entradas; el servidor recalcula todos los importes y nunca confía en los totales enviados por el cliente.
- **Sin punto flotante en los cálculos:** importes en centavos y porcentajes en puntos base (bps).

## Despliegue actual

La instancia de producción está en **Dokploy sobre Docker/Traefik**:

- POS: <https://totem.lapizzeria.food>
- Panel: <https://admin.lapizzeria.food>

La app está protegida por Basic Auth en el proxy, con HSTS y el puerto del panel cerrado desde Internet. La guía de operación, actualizaciones, respaldos y restauración está en [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md).

## Stack y decisiones técnicas

| Tecnología | Uso | Por qué |
|---|---|---|
| **Next.js 16 + React 19** | Interfaz | Stack solicitado. Permite una UI rápida, componentes reutilizables y proxy al API. |
| **Express 5** | API REST | Stack solicitado. Simple, directo y suficiente para un POS local. |
| **SQLite (`node:sqlite`)** | Base de datos | Persistencia real sin instalar un motor externo. Es el módulo SQLite integrado de Node: no requiere compilar dependencias nativas como `better-sqlite3` y funciona con un solo archivo. |
| **Zod** | Validación del API | Esquemas declarativos, mensajes en español y errores de campo consistentes. Evita que datos inválidos lleguen a la lógica de negocio. |
| **Vitest + Supertest** | Pruebas automatizadas | Pruebas unitarias del motor de precios y de integración HTTP contra SQLite en memoria. Rápidas y sin navegador. |
| **CSS propio con variables** | Estilos | Sin dependencias de UI ni utilidades de estilos. Control total del diseño táctil, menor peso y menos configuración. |
| **concurrently** | Scripts de desarrollo/arranque | Levanta API y web con un solo comando sin procesos manuales. |

No se agregó ORM, autenticación, gestor de estado global ni librería de componentes: el alcance no lo requiere y cada dependencia extra habría añadido configuración y superficie de fallo.

## Requisitos

- **Node.js 22.13 o superior** (recomendado Node 24 LTS o superior). El proyecto usa `node:sqlite`, disponible sin flag desde Node 22.13.
- npm 10+.
- Puerto **3000** libre para la web y **4000** libre para el API.

## Instalación y arranque

Desde la raíz del proyecto:

```bash
npm install --include=dev
npm run dev
```

La bandera `--include=dev` garantiza que también se instalen Vitest, Supertest y `concurrently`, incluso si tu shell tiene `NODE_ENV=production`.

Abre:

- POS: <http://localhost:3000>
- Historial: <http://localhost:3000/historial>
- Administración: <http://localhost:3000/admin>
- API directa: <http://localhost:4000/api/health>

En el primer arranque se crea `server/data/restpos.db` y se cargan automáticamente el menú de ejemplo, las categorías y las 8 mesas.

### Build de producción

```bash
npm run build
npm start
```

`npm start` levanta el API y el frontend ya compilado. La web sigue disponible en <http://localhost:3000>.

### Pruebas automatizadas

```bash
npm test
```

Modo interactivo:

```bash
npm run test:watch
```

Las pruebas usan SQLite en memoria y no alteran la base de datos de desarrollo.

### Reiniciar los datos de ejemplo

Detén la aplicación y ejecuta:

```bash
npm run db:reset
```

Esto elimina la base local, la recrea y vuelve a cargar el menú y las mesas de ejemplo. **Borra todas las ventas y pedidos locales.**

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | API con recarga y Next.js en modo desarrollo. |
| `npm run dev:api` | Solo el API en el puerto 4000. |
| `npm run dev:web` | Solo el frontend en el puerto 3000. |
| `npm run build` | Compila el frontend para producción. |
| `npm start` | Inicia API + frontend compilado. |
| `npm test` | Ejecuta las 35 pruebas automatizadas. |
| `npm run test:watch` | Pruebas en modo watch. |
| `npm run db:reset` | Recrea la base y los datos de ejemplo. |
| `npm run docker:build` | Construye las imágenes `restpos-api` y `restpos-web`. |

## Configuración opcional

La app funciona sin configurar nada. Las variables se leen del entorno del proceso:

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `4000` | Puerto del API. |
| `DATABASE_PATH` | `server/data/restpos.db` | Ruta del archivo SQLite. Usa `:memory:` para pruebas. |
| `APP_TIMEZONE` | `America/Mexico_City` | Zona horaria para el "día de venta" y los reportes. |
| `TAX_RATE_BPS` | `1600` | Impuesto en puntos base. `1600` = 16%. |
| `API_URL` | `http://127.0.0.1:4000` | Destino del proxy `/api` de Next.js. Útil si cambias el puerto del API. |

Ejemplo:

```bash
APP_TIMEZONE=America/Monterrey TAX_RATE_BPS=800 npm run dev
```

Si cambias `PORT`, arranca la web con el proxy correspondiente:

```bash
PORT=4100 API_URL=http://127.0.0.1:4100 npm run dev
```

La configuración del servidor no se lee desde un `.env` automáticamente: exporta las variables en tu shell o en el gestor de procesos.

## Arquitectura

```text
Navegador (tablet / desktop)
        │
        ▼
Next.js 3000 ── /api/* proxy ──▶ Express 4000
   UI React                         │
   autosave + UI optimista          ├─ validación Zod
                                    ├─ reglas de negocio
                                    ├─ cálculo autoritativo en centavos
                                    └─ SQLite (archivo local)
                                          server/data/restpos.db
```

### Estructura

```text
.
├── package.json                 # workspaces + scripts raíz
├── Dockerfile                   # imágenes API y web (multi-stage)
├── deploy/
│   ├── dokploy-compose.yml      # stack para Dokploy
│   ├── backup-restpos.sh        # respaldo diario de SQLite
│   ├── restpos-firewall.sh      # cierre del puerto 3000
│   └── traefik-restpos.example.yml
├── docs/
│   ├── DEPLOY-VPS.md            # operación del VPS
│   └── captura-pos.png
├── shared/
│   └── src/
│       ├── pricing.js           # motor de precios compartido
│       ├── money.js             # formato y parseo de dinero/porcentajes
│       └── index.js
├── server/
│   ├── src/
│   │   ├── server.js            # arranque, seed, cierre ordenado
│   │   ├── app.js               # Express, rutas y manejo de errores
│   │   ├── config.js
│   │   ├── db.js                # esquema, migración, seed y transacciones
│   │   ├── validation.js        # esquemas Zod
│   │   ├── orders.js            # pedidos, mesas, cobro y anulación
│   │   ├── admin.js             # CRUD de catálogo
│   │   ├── catalog.js
│   │   ├── reports.js
│   │   ├── serializers.js
│   │   ├── business-date.js
│   │   └── errors.js
│   ├── tests/                   # Vitest + Supertest
│   └── scripts/reset-db.js
├── web/
│   ├── app/
│   │   ├── (pos)/page.jsx       # POS
│   │   ├── (pos)/historial/     # historial + resumen
│   │   ├── (pos)/admin/         # administración
│   │   └── recibo/[id]/         # ticket imprimible
│   ├── components/
│   │   ├── pos/
│   │   ├── admin/
│   │   ├── AppHeader.jsx
│   │   ├── Modal.jsx
│   │   └── Icon.jsx
│   ├── lib/
│   │   ├── api.js
│   │   ├── format.js
│   │   └── useDraftOrder.js     # autosave serializado del pedido
│   └── app/globals.css
```

### Flujo de venta

1. Se toca una mesa libre o **Nuevo para llevar**. Se crea un pedido abierto.
2. Cada toque en un producto actualiza el pedido local al instante y programa un guardado automático (220 ms, serializado para no enviar versiones fuera de orden).
3. Al cobrar, el frontend espera a que se guarden los últimos cambios (`flush`) y envía el pago. El servidor recalcula todo desde su propia base antes de cerrar la venta.
4. Al pagar o anular, la mesa se libera en la misma transacción.
5. El ticket se abre en `/recibo/:id`; el botón **Imprimir ticket** abre esa página con `?print=1` y dispara el diálogo de impresión.

## Modelo de datos

- `categories`: categorías del menú, activas/inactivas y orden.
- `products`: productos con precio en centavos, categoría, disponibilidad y orden.
- `restaurant_tables`: mesas con capacidad y estado.
- `orders`: cabecera del pedido, tipo, mesa, estado, cliente, descuento, propina, impuesto, pago, totales y fechas.
- `order_items`: líneas con nombre y precio **congelados al momento de agregarlas**, cantidad, nota y clave de cliente.

### Estados

**Pedido:** `abierta` → `pagada` o `anulada`.

- Solo se puede editar/cobrar/anular un pedido `abierta`.
- Un pedido `pagada` o `anulada` es inmutable.
- Solo puede haber **un pedido abierto por mesa** (índice único parcial en SQLite).
- Al pagar o anular se libera la mesa.
- El estado visual de la mesa se deriva del pedido abierto.

### Reglas de cálculo

Todo se calcula en **centavos enteros** y con redondeo half-up al centavo:

```text
subtotal      = Σ (precio_unitario × cantidad)
descuento     = porcentaje(subtotal) o monto fijo limitado al subtotal
base_gravable = subtotal − descuento
impuesto      = round_half_up(base_gravable × tasa)
total_sin_propina = base_gravable + impuesto
propina       = porcentaje(total_sin_propina) o monto fijo
total         = total_sin_propina + propina
cambio        = efectivo_recibido − total   (solo efectivo)
```

- La propina se calcula sobre el total **con impuesto** y no recibe impuesto.
- El descuento se aplica **antes** del impuesto.
- Los porcentajes se guardan en **puntos base**: `1000` = 10%, `1500` = 15%.
- Los montos fijos se guardan en centavos: `5000` = $50.00.
- Un pedido de $0 (por ejemplo, descuento del 100%) se puede cobrar.
- El efectivo recibido debe ser mayor o igual al total.
- El cliente puede enviar totales alterados: se ignoran y el servidor recalcula.

El "día de venta" de un pedido se fija al cobrarlo usando `APP_TIMEZONE`; el historial y el reporte diario filtran por ese campo.

## API

Base: `/api`. El frontend la consume a través del proxy de Next.js en el mismo origen.

Todas las respuestas exitosas son JSON. Los errores tienen esta forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Revisa los datos enviados.",
    "details": {
      "fields": [{ "path": "items[0].quantity", "message": "La cantidad mínima es 1." }]
    }
  }
}
```

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del API, zona horaria, moneda y tasa. |
| `GET` | `/api/catalog` | Categorías activas con sus productos (incluye productos agotados con `active: false`). |
| `GET` | `/api/tables` | Mesas con estado y resumen del pedido abierto. |
| `GET` | `/api/orders` | Lista/resumen de pedidos. Filtros: `status`, `type`, `date`, `limit`, `offset`. |
| `GET` | `/api/orders/:id` | Pedido completo con líneas. |
| `POST` | `/api/orders` | Crea un pedido abierto de mesa o para llevar. |
| `PATCH` | `/api/orders/:id/draft` | Reemplaza el contenido del pedido abierto. |
| `POST` | `/api/orders/:id/pay` | Cobra un pedido abierto y libera la mesa. |
| `POST` | `/api/orders/:id/cancel` | Anula un pedido abierto y libera la mesa. |
| `GET` | `/api/reports/daily?date=YYYY-MM-DD` | Resumen de ventas del día. Sin `date` usa hoy. |
| `GET` | `/api/admin/categories` | Todas las categorías, incluidas inactivas. |
| `POST` | `/api/admin/categories` | Crea una categoría. |
| `PATCH` | `/api/admin/categories/:id` | Edita o desactiva una categoría. |
| `GET` | `/api/admin/products` | Todos los productos, incluidos inactivos. |
| `POST` | `/api/admin/products` | Crea un producto. |
| `PATCH` | `/api/admin/products/:id` | Edita o desactiva un producto. |

### Crear un pedido

```bash
# Mesa
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"type":"mesa","tableId":1,"customerName":"Ana"}'

# Para llevar
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"type":"llevar"}'
```

### Guardar el contenido del pedido

`PATCH /api/orders/:id/draft` reemplaza las líneas actuales por el arreglo enviado. Cada línea tiene una `clientKey` estable generada por el cliente; esto permite autoguardados idempotentes y evita duplicados.

```bash
curl -X PATCH http://localhost:4000/api/orders/1/draft \
  -H 'Content-Type: application/json' \
  -d '{
    "items": [
      {"clientKey":"line-a1b2c3d4","productId":1,"quantity":2,"notes":"Sin cebolla"},
      {"clientKey":"line-e5f6g7h8","productId":10,"quantity":3,"notes":""}
    ],
    "customerName":"Ana",
    "discountType":"percent",
    "discountValue":1000,
    "tipType":"percent",
    "tipValue":1500
  }'
```

Los campos de descuento y propina son opcionales en la petición; si se omiten se conserva lo que ya tenía el pedido. `items` también es opcional, pero el POS siempre envía el reemplazo completo.

### Cobrar

```bash
# Efectivo: 30000 centavos = $300.00
curl -X POST http://localhost:4000/api/orders/1/pay \
  -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"efectivo","cashReceivedCents":30000}'

# Tarjeta: no se envía efectivo y el cambio es 0
curl -X POST http://localhost:4000/api/orders/1/pay \
  -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"tarjeta"}'
```

Métodos válidos: `efectivo`, `tarjeta`, `otro`.

### Administración

```bash
# Crear categoría
curl -X POST http://localhost:4000/api/admin/categories \
  -H 'Content-Type: application/json' \
  -d '{"name":"Especiales","description":"Temporada","sortOrder":50}'

# Crear producto (precio en centavos)
curl -X POST http://localhost:4000/api/admin/products \
  -H 'Content-Type: application/json' \
  -d '{"categoryId":1,"name":"Croquetas","priceCents":7500,"description":"De queso","active":true}'

# Desactivar producto
curl -X PATCH http://localhost:4000/api/admin/products/18 \
  -H 'Content-Type: application/json' \
  -d '{"active":false}'
```

### Respuesta de pedido

```json
{
  "order": {
    "id": 1,
    "orderNumber": "P-00001",
    "type": "mesa",
    "tableId": 1,
    "tableName": "Mesa 1",
    "status": "pagada",
    "items": [
      {
        "clientKey": "line-a1b2c3d4",
        "productId": 1,
        "productName": "Guacamole con totopos",
        "unitPriceCents": 8900,
        "quantity": 2,
        "notes": "Sin cebolla",
        "lineTotalCents": 17800
      }
    ],
    "subtotalCents": 17800,
    "discountType": "percent",
    "discountValue": 1000,
    "discountCents": 1780,
    "taxRateBps": 1600,
    "taxCents": 2563,
    "tipType": "percent",
    "tipValue": 1500,
    "tipCents": 2787,
    "totalCents": 21370,
    "paymentMethod": "efectivo",
    "cashReceivedCents": 30000,
    "changeCents": 8630,
    "businessDate": "2026-11-09",
    "createdAt": "2026-11-10T01:54:34.197Z",
    "paidAt": "2026-11-10T01:56:10.000Z"
  }
}
```

`GET /api/orders` devuelve resúmenes (`items: []` y `itemCount`) para el historial; para el detalle completo usa `GET /api/orders/:id`.

### Reporte diario

`GET /api/reports/daily?date=2026-11-09` devuelve:

- `orderCount`: pedidos pagados.
- `subtotalCents`, `discountCents`, `taxCents`, `tipCents`.
- `salesCents`: ventas sin propina (`subtotal − descuento + impuesto`).
- `totalCollectedCents`: cobrado, incluida la propina.
- `averageTicketCents`: cobrado / pedidos.
- `payments`: desglose por método.
- `topProducts`: ranking por unidades vendidas.

### Códigos de error

| Código | HTTP | Significado |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Datos inválidos; incluye campos. |
| `UNPROCESSABLE_ENTITY` | 422 | Regla de negocio incumplida (p. ej. efectivo insuficiente, pedido vacío). |
| `CONFLICT` | 409 | Mesa ya ocupada, pedido cerrado o cambio incompatible. |
| `NOT_FOUND` | 404 | Recurso inexistente. |
| `INVALID_JSON` | 400 | Cuerpo JSON malformado. |
| `INTERNAL_ERROR` | 500 | Error inesperado; no se filtran detalles internos. |

## Pruebas incluidas

`npm test` ejecuta **35 pruebas**:

- **Motor de precios:** subtotal, impuesto del 16%, redondeo half-up, descuento porcentual/fijo, propina porcentual/fija, múltiples líneas sin errores flotantes y cambio en efectivo.
- **Utilidades de dinero:** conversión de texto a centavos con coma/punto, porcentajes a bps y formato.
- **Validación:** tipos de pedido, mesa requerida, cantidades, porcentajes, métodos de pago, JSON inválido, productos inactivos y actualizaciones vacías.
- **Mesas y pedidos:** ocupación/liberación, un pedido abierto por mesa, totales autoritativos, notas, bloqueo de pedidos cerrados, cobro con tarjeta/efectivo, cambio, anulación y pedidos para llevar.
- **Catálogo:** snapshot de precios ante cambios posteriores y conservación de líneas cuando un producto se desactiva.
- **Administración y reportes:** CRUD, duplicados, categorías inactivas, catálogo agrupado, ventas, propinas, métodos de pago, productos top y fechas inválidas.

La UI se comprobó además con build de producción y un recorrido de navegador (mesa, para llevar, notas, descuento, propina, efectivo, tarjeta, ticket, historial, administración y vistas móviles).

## Decisiones de alcance

- **Sin autenticación:** la app está pensada para una terminal local de confianza. No incluye roles ni login.
- **Sin pasarela de pago:** solo se registra el método y, en efectivo, el cambio. No se cobran tarjetas reales.
- **Un solo servicio:** API y web son dos procesos, pero un único backend y una única base; no hay microservicios.
- **SQLite síncrono:** excelente para una terminal local. Para varias terminales simultáneas haría falta una base cliente-servidor y sincronización en tiempo real.
- **Los precios de las líneas se congelan** al agregarlas; un cambio de precio en administración no altera pedidos ya abiertos.
- **Las categorías/productos se desactivan, no se eliminan**, para conservar la integridad del historial.

## Mejoras futuras con mayor valor

1. **Roles y auditoría** (mesero, cajero, gerente) con trazabilidad de descuentos, anulaciones y arqueo de caja.
2. **Integración con impresora térmica ESC/POS** y envío automático de comandas a cocina, además del ticket al cliente.
3. **Inventario y recetas** con descuento automático por venta y alertas de stock.
4. **División de cuenta y pagos mixtos**, propinas por mesero y cierre de turno.
5. **Modo offline con sincronización** para tolerar caídas de red, y **KDS** (pantalla de cocina) en tiempo real.
