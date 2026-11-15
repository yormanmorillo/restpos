/**
 * Catálogo central de funciones activables.
 * defaultEnabled: true conserva los módulos que ya existían.
 * defaultEnabled: false deja las funciones nuevas apagadas hasta que el
 * super admin las active desde Administración → Ajustes → Funciones.
 */
export const FEATURES = {
  inventory: {
    label: 'Inventario y recetas',
    description: 'Insumos, entradas de mercancía, ajustes y descuento por receta.',
    phase: 0,
    defaultEnabled: true,
  },
  bulk_import: {
    label: 'Carga masiva de productos',
    description: 'Importación de productos por archivo CSV.',
    phase: 0,
    defaultEnabled: true,
  },
  integrations: {
    label: 'Integraciones externas',
    description: 'Configuración de APIs externas para el futuro.',
    phase: 0,
    defaultEnabled: true,
  },
  whatsapp_receipt: {
    label: 'Factura por WhatsApp',
    description: 'Enlace público y envío de la factura por WhatsApp.',
    phase: 0,
    defaultEnabled: true,
  },
  browser_printing: {
    label: 'Impresión desde el navegador',
    description: 'Impresión con el controlador instalado en el dispositivo.',
    phase: 0,
    defaultEnabled: true,
  },
  split_bill: {
    label: 'Dividir cuenta',
    description: 'Cobro independiente por ítem, persona o asiento.',
    phase: 1,
    defaultEnabled: false,
  },
  refunds: {
    label: 'Anulaciones y reembolsos',
    description: 'Reembolso de pedidos pagados con motivo y autorización.',
    phase: 1,
    defaultEnabled: false,
  },
  table_transfer_merge: {
    label: 'Mover y unir mesas',
    description: 'Transferir mesas, unir cuentas y pasar ítems entre pedidos.',
    phase: 1,
    defaultEnabled: false,
  },
  offline_mode: {
    label: 'Modo sin conexión',
    description: 'Cola local de pedidos y cobros con sincronización.',
    phase: 1,
    defaultEnabled: false,
  },
  inventory_sold_out: {
    label: 'Agotados por inventario',
    description: 'Marca y bloquea productos cuando su receta no tiene stock suficiente.',
    phase: 2,
    defaultEnabled: false,
  },
  kitchen_stations: {
    label: 'Cocina por estaciones',
    description: 'Barra, parrilla, postres y vista de expedición.',
    phase: 2,
    defaultEnabled: false,
  },
  customers_loyalty: {
    label: 'Clientes y fidelidad',
    description: 'Perfiles, puntos, gift cards, cupones, combos y happy hour.',
    phase: 2,
    defaultEnabled: false,
  },
  reservations: {
    label: 'Reservas y lista de espera',
    description: 'Reservas de mesa y administración de espera.',
    phase: 2,
    defaultEnabled: false,
  },
  qr_table_order: {
    label: 'Pedido por QR en mesa',
    description: 'Menú y pedido desde el teléfono del cliente.',
    phase: 2,
    defaultEnabled: false,
  },
  staff_scheduling: {
    label: 'Horarios y propinas',
    description: 'Horarios, control de horas y reparto de propinas.',
    phase: 3,
    defaultEnabled: false,
  },
  inventory_advanced: {
    label: 'Inventario avanzado',
    description: 'Proveedores, compras, costos por receta y consumo teórico.',
    phase: 3,
    defaultEnabled: false,
  },
  reports_advanced: {
    label: 'Reportes avanzados',
    description: 'Márgenes, comparativas y exportación contable.',
    phase: 3,
    defaultEnabled: false,
  },
};

export const FEATURE_KEYS = Object.keys(FEATURES);

export function featureSettingKey(key) {
  return `feature_${key}`;
}

export function defaultFeatureFlags() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, FEATURES[key].defaultEnabled]));
}
