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
  const totalCollectedCents = Number(aggregate.total_cents);
  const salesCents = subtotalCents - discountCents + taxCents;

  const paymentRows = db
    .prepare(`
      SELECT payment_method, COUNT(*) AS order_count, COALESCE(SUM(total_cents), 0) AS total_cents
      FROM orders
      WHERE status = 'pagada' AND business_date = ?
      GROUP BY payment_method
    `)
    .all(reportDate);
  const payments = {};
  for (const method of PAYMENT_METHODS) {
    const row = paymentRows.find((item) => item.payment_method === method);
    payments[method] = {
      orderCount: row ? Number(row.order_count) : 0,
      totalCents: row ? Number(row.total_cents) : 0,
    };
  }

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
      LIMIT 8
    `)
    .all(reportDate)
    .map((row) => ({
      productName: row.product_name,
      quantity: Number(row.quantity),
      revenueCents: Number(row.revenue_cents),
    }));

  return {
    date: reportDate,
    timezone: config.timezone,
    currency: config.currency,
    orderCount,
    subtotalCents,
    discountCents,
    taxCents,
    tipCents,
    salesCents,
    totalCollectedCents,
    averageTicketCents: orderCount > 0 ? Math.round(totalCollectedCents / orderCount) : 0,
    payments,
    topProducts,
  };
}
