# Diseño propuesto: modo sin conexión

> Estado: **primera versión implementada** (ventas para llevar en efectivo).
> Bandera: `feature_offline_mode` (apagada por defecto).
> Las ventas offline se guardan en el dispositivo y se sincronizan con `POST /api/offline/sales` usando un `operationId` idempotente.

## Objetivo

Permitir que una terminal siga creando pedidos y cobrando cuando se interrumpe la conexión con el servidor, sin duplicar ventas ni perder el cuadre de caja.

## Arquitectura propuesta

1. **PWA con Service Worker**
   - Cachea el shell de la aplicación, el catálogo activo y los métodos de pago.
   - No cachea respuestas autenticadas sensibles ni comprobantes.
   - Detecta `online/offline` y muestra un estado visible en el header.

2. **Cola local en IndexedDB**
   - Cada operación se guarda con:
     - `operationId` UUID generado por el dispositivo.
     - `deviceId` persistente.
     - `staffId`, `shiftId` y `createdAt`.
     - Tipo: crear pedido, editar líneas, enviar a cocina, pago, cortesía.
   - La UI opera siempre contra la cola; el servidor confirma y reconcilia.

3. **Idempotencia en el servidor**
   - Nueva tabla `sync_operations` con `operation_id UNIQUE`.
   - Toda operación acepta `Idempotency-Key`; repetirla devuelve el resultado original.
   - Los pagos usan la misma clave para no cobrar dos veces.

4. **Sincronización**
   - Al reconectar, se envían operaciones en orden por pedido.
   - El servidor responde con `applied`, `conflict` o `rejected`.
   - La cola se reintenta con backoff; nunca se descarta silenciosamente.

## Resolución de conflictos

- **Catálogo/precios:** el servidor manda. Si cambió un precio, la operación se marca `needs_review`; no se cobra automáticamente.
- **Mesas:** si la mesa ya está ocupada por otro pedido, el pedido local queda en conflicto y se ofrece moverlo a otra mesa.
- **Pagos:** si el saldo ya fue cubierto, el pago local se marca duplicado y se conserva para revisión.
- **Inventario:** la venta offline descuenta stock al sincronizar; si el stock es insuficiente, se registra la venta y se genera una alerta, nunca se bloquea el cobro ya realizado.
- **Caja:** los pagos offline se asignan al turno local; al reconectar se valida que el turno siga abierto. Si ya cerró, se envía a revisión de gerencia.

## Seguridad

- La sesión offline se limita a un dispositivo autorizado y a un PIN válido reciente.
- La cola local se cifra con una clave derivada del dispositivo; no se guardan PINs.
- El logout borra la cola pendiente solo después de confirmar sincronización.
- Los comprobantes y datos de tarjeta no se guardan offline.

## Requisitos previos

- Cambios de esquema para `device_id`, `sync_operations` y estados de sincronización.
- Endpoints idempotentes y un protocolo de reconciliación.
- Pruebas de simulación de red, duplicados, conflictos de mesa y cierre de caja.
- Definir política de negocio para ventas offline con stock insuficiente.

## Limitaciones de la primera versión

- Solo ventas para llevar y efectivo.
- No admite modificadores, propinas, delivery ni mesas.
- No emite ticket desde el dispositivo offline.
- Si el precio cambió o el turno se cerró, la operación queda en cola con error para revisión.

## Decisiones pendientes

- ¿La terminal puede cobrar con tarjeta offline? Se propone **no**: solo efectivo/transferencia con comprobante posterior.
- ¿Cuántos días se conserva una operación sin sincronizar?
- ¿Qué rol autoriza la resolución de conflictos?
