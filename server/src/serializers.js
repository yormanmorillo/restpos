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


export function serializeOrderItem(row, modifiers = []) {
  return {
    id: Number(row.id),
    clientKey: row.client_key,
    productId: row.product_id === null ? null : Number(row.product_id),
    productName: row.product_name,
    unitPriceCents: Number(row.unit_price_cents),
    quantity: Number(row.quantity),
    notes: row.notes,
    lineTotalCents: Number(row.line_total_cents),
    status: row.status ?? 'pending',
    course: Number(row.course ?? 1),
    sentAt: row.sent_at ?? null,
    readyAt: row.ready_at ?? null,
    servedAt: row.served_at ?? null,
    modifiersTotalCents: Number(row.modifiers_total_cents ?? 0),
    modifiers: modifiers.map((modifier) => ({
      id: Number(modifier.id),
      modifierId: modifier.modifier_id === null ? null : Number(modifier.modifier_id),
      groupName: modifier.group_name,
      modifierName: modifier.modifier_name,
      priceDeltaCents: Number(modifier.price_delta_cents),
    })),
  };
}

export function serializePayment(row) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    shiftId: row.shift_id === null ? null : Number(row.shift_id),
    staffId: row.staff_id === null ? null : Number(row.staff_id),
    staffName: row.staff_name ?? null,
    paymentMethod: row.payment_method,
    amountCents: Number(row.amount_cents),
    cashReceivedCents: row.cash_received_cents === null ? null : Number(row.cash_received_cents),
    changeCents: row.change_cents === null ? null : Number(row.change_cents),
    createdAt: row.created_at,
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
    customerPhone: row.customer_phone ?? '',
    notes: row.notes,
    delivery: Boolean(row.delivery),
    deliveryAddress: row.delivery_address ?? '',
    deliveryFeeCents: Number(row.delivery_fee_cents ?? 0),
    source: row.source ?? 'pos',
    scheduledFor: row.scheduled_for ?? null,
    items: items.map((item) => serializeOrderItem(item, item.modifiers ?? [])),
    itemCount: row.item_count === undefined ? items.length : Number(row.item_count),
    amountPaidCents: Number(row.amount_paid_cents ?? 0),
    balanceCents: Math.max(0, Number(row.total_cents) - Number(row.amount_paid_cents ?? 0)),
    openedByStaffId: row.opened_by_staff_id === null ? null : Number(row.opened_by_staff_id),
    closedByStaffId: row.closed_by_staff_id === null ? null : Number(row.closed_by_staff_id),
    shiftId: row.shift_id === null ? null : Number(row.shift_id),
    kitchenSentAt: row.kitchen_sent_at ?? null,
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
