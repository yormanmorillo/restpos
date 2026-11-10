export function serializeCategory(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
    productCount: row.product_count === undefined ? undefined : Number(row.product_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeProduct(row) {
  return {
    id: Number(row.id),
    categoryId: Number(row.category_id),
    categoryName: row.category_name,
    name: row.name,
    description: row.description,
    priceCents: Number(row.price_cents),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export function serializeOrderItem(row) {
  return {
    id: Number(row.id),
    clientKey: row.client_key,
    productId: row.product_id === null ? null : Number(row.product_id),
    productName: row.product_name,
    unitPriceCents: Number(row.unit_price_cents),
    quantity: Number(row.quantity),
    notes: row.notes,
    lineTotalCents: Number(row.line_total_cents),
  };
}

export function serializeOrder(row, items = []) {
  return {
    id: Number(row.id),
    orderNumber: row.order_number,
    type: row.type,
    tableId: row.table_id === null ? null : Number(row.table_id),
    tableName: row.table_name ?? null,
    status: row.status,
    customerName: row.customer_name,
    notes: row.notes,
    items: items.map(serializeOrderItem),
    itemCount: row.item_count === undefined ? items.length : Number(row.item_count),
    subtotalCents: Number(row.subtotal_cents),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    discountCents: Number(row.discount_cents),
    taxRateBps: Number(row.tax_rate_bps),
    taxCents: Number(row.tax_cents),
    tipType: row.tip_type,
    tipValue: Number(row.tip_value),
    tipCents: Number(row.tip_cents),
    totalCents: Number(row.total_cents),
    paymentMethod: row.payment_method ?? null,
    cashReceivedCents: row.cash_received_cents === null ? null : Number(row.cash_received_cents),
    changeCents: row.change_cents === null ? null : Number(row.change_cents),
    businessDate: row.business_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
  };
}
