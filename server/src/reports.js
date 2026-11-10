import { businessDateFor } from './business-date.js';

const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'otro'];

export function getDailyReport(db, config, date, { now = new Date() } = {}) {
  const reportDate = date ?? businessDateFor(now, config.timezone);
  const aggregate = db
    .prepare(`
      SELECT
        COUNT(*) AS order_count,
        COALESCE(SUM(subtotal_cents), 0) AS subtotal_cents,
        COALESCE(SUM(discount_cents), 0) AS discount_cents,
        COALESCE(SUM(tax_cents), 0) AS tax_cents,
        COALESCE(SUM(tip_cents), 0) AS tip_cents,
        COALESCE(SUM(delivery_fee_cents), 0) AS delivery_fees_cents,
        COALESCE(SUM(total_cents), 0) AS total_cents
      FROM orders
      WHERE status = 'pagada' AND business_date = ?
    `)
    .get(reportDate);

  const orderCount = Number(aggregate.order_count);
  const subtotalCents = Number(aggregate.subtotal_cents);
  const discountCents = Number(aggregate.discount_cents);
  const taxCents = Number(aggregate.tax_cents);
  const tipCents = Number(aggregate.tip_cents);
  const deliveryFeesCents = Number(aggregate.delivery_fees_cents);
  const totalCollectedCents = Number(aggregate.total_cents);
  const salesCents = subtotalCents - discountCents + taxCents + deliveryFeesCents;

  const paymentRows = db
    .prepare(`
      SELECT p.payment_method, p.method_name, p.method_kind,
             COUNT(DISTINCT p.order_id) AS order_count,
             COALESCE(SUM(p.amount_cents), 0) AS total_cents
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE o.status = 'pagada' AND o.business_date = ?
      GROUP BY p.payment_method, p.method_name, p.method_kind
      ORDER BY MIN(p.id)
    `)
    .all(reportDate);
  const payments = {};
  for (const method of PAYMENT_METHODS) {
    const rows = paymentRows.filter((item) =>
      method === 'efectivo'
        ? item.method_kind === 'cash'
        : method === 'tarjeta'
          ? item.method_kind === 'card'
          : !['cash', 'card'].includes(item.method_kind),
    );
    payments[method] = {
      orderCount: rows.reduce((sum, row) => sum + Number(row.order_count), 0),
      totalCents: rows.reduce((sum, row) => sum + Number(row.total_cents), 0),
    };
  }
  const paymentMethods = paymentRows.map((row) => ({
    code: row.payment_method,
    name: row.method_name || row.payment_method,
    kind: row.method_kind || 'other',
    orderCount: Number(row.order_count),
    totalCents: Number(row.total_cents),
  }));

  const topProducts = db
    .prepare(`
      SELECT oi.product_name AS product_name,
             SUM(oi.quantity) AS quantity,
             SUM(oi.line_total_cents) AS revenue_cents
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'pagada' AND o.business_date = ?
      GROUP BY oi.product_name
      ORDER BY quantity DESC, revenue_cents DESC, oi.product_name ASC
      LIMIT 10
    `)
    .all(reportDate)
    .map((row) => ({
      productName: row.product_name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue_cents),
    }));

  const categories = db
    .prepare(`
      SELECT COALESCE(c.name, 'Sin categoría') AS name,
             SUM(oi.quantity) AS quantity,
             SUM(oi.line_total_cents) AS revenue_cents
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.status = 'pagada' AND o.business_date = ?
      GROUP BY c.id
      ORDER BY revenue_cents DESC, name ASC
    `)
    .all(reportDate)
    .map((row) => ({
      name: row.name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue_cents),
    }));

  const staff = db
    .prepare(`
      SELECT COALESCE(st.id, 0) AS staff_id, COALESCE(st.name, 'Sin asignar') AS staff_name,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(o.subtotal_cents - o.discount_cents + o.tax_cents + o.delivery_fee_cents), 0) AS sales_cents,
             COALESCE(SUM(o.tip_cents), 0) AS tip_cents
      FROM orders o
      LEFT JOIN staff st ON st.id = o.opened_by_staff_id
      WHERE o.status = 'pagada' AND o.business_date = ?
      GROUP BY st.id
      ORDER BY sales_cents DESC, staff_name ASC
    `)
    .all(reportDate)
    .map((row) => ({
      staffId: row.staff_id ? Number(row.staff_id) : null,
      staffName: row.staff_name,
      orderCount: Number(row.order_count),
      salesCents: Number(row.sales_cents),
      tipCents: Number(row.tip_cents),
    }));

  const paidOrders = db
    .prepare(`
      SELECT id, paid_at, created_at, total_cents, tip_cents
      FROM orders
      WHERE status = 'pagada' AND business_date = ?
      ORDER BY paid_at
    `)
    .all(reportDate);
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false,
  });
  const hoursMap = new Map(
    Array.from({ length: 24 }, (_, hour) => [hour, { hour, orderCount: 0, salesCents: 0 }]),
  );
  for (const order of paidOrders) {
    const hour = Number(hourFormatter.format(new Date(order.paid_at ?? order.created_at)));
    const bucket = hoursMap.get(hour);
    if (!bucket) continue;
    bucket.orderCount += 1;
    bucket.salesCents += Number(order.total_cents) - Number(order.tip_cents);
  }

  return {
    date: reportDate,
    timezone: config.timezone,
    currency: config.currency,
    orderCount,
    subtotalCents,
    discountCents,
    taxCents,
    tipCents,
    deliveryFeesCents,
    salesCents,
    totalCollectedCents,
    averageTicketCents: orderCount > 0 ? Math.round(totalCollectedCents / orderCount) : 0,
    payments,
    paymentMethods,
    topProducts,
    categories,
    staff,
    hours: [...hoursMap.values()],
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function dailyReportCsv(report) {
  const rows = [
    ['Reporte diario', ''],
    ['Fecha', report.date],
    ['Zona horaria', report.timezone],
    ['Moneda', report.currency],
    ['Pedidos pagados', report.orderCount],
    ['Ventas sin propina', report.salesCents / 100],
    ['Cobrado total', report.totalCollectedCents / 100],
    ['Propinas', report.tipCents / 100],
    ['Subtotal', report.subtotalCents / 100],
    ['Descuentos', report.discountCents / 100],
    ['Impuestos', report.taxCents / 100],
    ['Costos de entrega', report.deliveryFeesCents / 100],
    [],
    ['Método de pago', 'Pedidos', 'Total'],
    ...(report.paymentMethods?.length
      ? report.paymentMethods.map((method) => [method.name, method.orderCount, method.totalCents / 100])
      : Object.entries(report.payments).map(([method, data]) => [method, data.orderCount, data.totalCents / 100])),
    [],
    ['Producto', 'Unidades', 'Ingresos'],
    ...report.topProducts.map((item) => [item.productName, item.quantity, item.revenueCents / 100]),
    [],
    ['Categoría', 'Unidades', 'Ingresos'],
    ...report.categories.map((item) => [item.name, item.quantity, item.revenueCents / 100]),
    [],
    ['Empleado', 'Pedidos', 'Ventas', 'Propinas'],
    ...report.staff.map((item) => [item.staffName, item.orderCount, item.salesCents / 100, item.tipCents / 100]),
    [],
    ['Hora', 'Pedidos', 'Ventas'],
    ...report.hours.map((item) => [String(item.hour).padStart(2, '0') + ':00', item.orderCount, item.salesCents / 100]),
  ];
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\n');
}
