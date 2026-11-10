# Métodos de pago para Costa Rica

Guía de referencia para configurar el POS. Los métodos se administran desde **Administración → Pagos** y se seleccionan al cobrar.

## Panorama del mercado

Costa Rica combina pagos electrónicos de alto uso con efectivo y un entorno de **doble moneda (CRC y USD)**:

- **Tarjetas de débito y crédito:** el medio con mayor presencia en comercios y restaurantes. Se cobran con datáfono externo; el POS solo registra el método y el importe.
- **SINPE Móvil:** transferencia inmediata del Sistema Nacional de Pagos Electrónicos del Banco Central, identificada por número de teléfono. Es el riel digital más utilizado para pagos cotidianos y pequeños consumos. En comercios conviene guardar el comprobante.
- **Transferencia bancaria:** misma u otra entidad; también se recomienda adjuntar comprobante.
- **Efectivo:** colones y dólares estadounidenses circulan ampliamente. El POS maneja una moneda base; si se cobra en otra moneda, el cajero debe registrar el importe convertido y el método puede llamarse “Efectivo USD” para dejarlo explícito.
- **Billeteras digitales y enlaces de pago:** opcionales según el banco o proveedor; se pueden crear como métodos personalizados.

Fuentes de referencia:

- [dLocal — métodos de pago en Costa Rica](https://www.dlocal.com/pt/processadores-de-pagamento-na-america-latina/costa-rica-processadores-de-metodos-de-pagamento-e-commerce-mercado-dlocal/)
- [Banco Central de Costa Rica — SINPE Móvil](https://www.bccr.fi.cr/cr/es/noticias/listado-de-noticias/2025/banco-central-aclara-sinpe-movil-funciona-sin-ninguna-prohibicion.html)
- [MEIC — comparativo de medios de pago 2024](https://www.meic.go.cr/wp-content/uploads/2025/10/DAEC-INF-010-2025_Comparativo_Medios_Pago_II_2024-1.pdf)
- [PaymentBrief — Costa Rica payments](https://paymentbrief.com/markets/costa-rica/)

## Métodos iniciales del sistema

La base crea estos métodos activos:

| Método | Tipo | Comprobante |
|---|---|---|
| Efectivo | Efectivo | No |
| Tarjeta débito/crédito | Tarjeta | No |
| SINPE Móvil | Transferencia | Foto opcional |
| Transferencia bancaria | Transferencia | Foto opcional |
| Otro | Otro | No |

El administrador puede:

- Crear métodos con nombre, código interno, tipo, icono, orden y visibilidad.
- Activar o desactivar métodos.
- Permitir u obligar la foto del comprobante.
- Dejar al menos un método activo.
- Conservar el nombre histórico de los pagos aunque el método se desactive.

## SINPE Móvil y comprobantes

El POS permite adjuntar hasta **6 fotos por pago** (máximo 6 MB cada una; el navegador las optimiza antes de subirlas). Las fotos quedan ligadas al pago, son visibles desde el detalle del pago y se guardan en el volumen persistente del servidor.

Flujo recomendado:

1. El cliente realiza el SINPE Móvil al número del restaurante.
2. El cajero selecciona **SINPE Móvil**.
3. Adjunta una captura del comprobante y confirma el cobro.
4. El pago queda registrado con nombre de método, importe y fotos para auditoría.

La foto también puede adjuntarse después desde el historial de pagos del pedido, siempre que el método elegido permita comprobante.

## Factura electrónica

Este POS genera un **ticket interno** y control de caja; **no sustituye la factura electrónica de Hacienda**. Para operar formalmente en Costa Rica se debe integrar un proveedor de facturación electrónica autorizado (versión 4.4 o la vigente) y enviar el comprobante correspondiente. La foto de SINPE sirve como respaldo operativo, no como comprobante fiscal.

## Tarjetas

El POS **no procesa tarjetas** ni almacena datos de tarjeta. El cobro se realiza en la terminal bancaria/datáfono y el cajero registra el resultado en el POS con el método “Tarjeta débito/crédito”.
