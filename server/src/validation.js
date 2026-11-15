import { z } from 'zod';
import { MAX_ITEM_QUANTITY, MAX_LINE_ITEMS, MAX_PRICE_CENTS } from '@restpos/shared/pricing';
import { isValidBusinessDate } from './business-date.js';
import { zodToValidationError, validationError } from './errors.js';

const text = (max, label) => z.string().trim().max(max, `${label} no puede exceder ${max} caracteres.`);

const moneyCents = z
  .number({ error: 'El precio debe ser un número entero en centavos.' })
  .int('El precio debe expresarse en centavos, sin decimales.')
  .min(0, 'El precio no puede ser negativo.')
  .max(MAX_PRICE_CENTS, `El precio no puede superar ${MAX_PRICE_CENTS / 100}.`);

const adjustmentValue = z
  .number({ error: 'El valor debe ser un número entero.' })
  .int('El valor debe ser un entero.')
  .min(0, 'El valor no puede ser negativo.')
  .max(10_000_000, 'El valor es demasiado grande.');

const clientKey = z
  .string({ error: 'Cada línea debe incluir un identificador.' })
  .trim()
  .min(6, 'El identificador de línea no es válido.')
  .max(80, 'El identificador de línea es demasiado largo.')
  .regex(/^[A-Za-z0-9_-]+$/, 'El identificador de línea contiene caracteres inválidos.');

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive('El identificador debe ser un entero positivo.'),
});

export const photoIdParamsSchema = z.object({
  photoId: z.coerce.number().int().positive('El identificador del comprobante no es válido.'),
});

export const orderPaymentParamsSchema = z.object({
  id: z.coerce.number().int().positive('El identificador del pedido no es válido.'),
  paymentId: z.coerce.number().int().positive('El identificador del pago no es válido.'),
});

export const createOrderSchema = z
  .object({
    type: z.enum(['mesa', 'llevar'], { error: 'El tipo de pedido debe ser "mesa" o "llevar".' }),
    tableId: z.number().int().positive('La mesa debe ser un identificador válido.').nullable().optional(),
    customerId: z.number().int().positive().nullable().optional(),
    customerName: text(100, 'El nombre del cliente').optional().default(''),
    customerPhone: text(30, 'El teléfono').optional().default(''),
    notes: text(500, 'Las notas del pedido').optional().default(''),
    delivery: z.boolean().optional().default(false),
    deliveryAddress: text(300, 'La dirección de entrega').optional().default(''),
    scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'mesa' && !value.tableId) {
      ctx.addIssue({
        code: 'custom',
        path: ['tableId'],
        message: 'Selecciona una mesa para este pedido.',
      });
    }
    if (value.type === 'llevar' && value.tableId) {
      ctx.addIssue({
        code: 'custom',
        path: ['tableId'],
        message: 'Un pedido para llevar no puede tener mesa.',
      });
    }
    if (value.delivery && value.type !== 'llevar') {
      ctx.addIssue({
        code: 'custom',
        path: ['delivery'],
        message: 'Solo un pedido para llevar puede ser a domicilio.',
      });
    }
  });

export const draftItemSchema = z.object({
  clientKey,
  productId: z.number({ error: 'Selecciona un producto válido.' }).int().positive('El producto no es válido.'),
  quantity: z
    .number({ error: 'La cantidad es obligatoria.' })
    .int('La cantidad debe ser un entero.')
    .min(1, 'La cantidad mínima es 1.')
    .max(MAX_ITEM_QUANTITY, `La cantidad máxima por línea es ${MAX_ITEM_QUANTITY}.`),
  notes: text(200, 'La nota del producto').optional().default(''),
  modifiers: z
    .array(z.number().int().positive('El modificador no es válido.'))
    .max(20, 'Demasiados modificadores en una línea.')
    .optional()
    .default([]),
  course: z.number().int().min(1).max(20).optional().default(1),
});

export const draftSchema = z
  .object({
    items: z
      .array(draftItemSchema)
      .max(MAX_LINE_ITEMS, `El pedido no puede tener más de ${MAX_LINE_ITEMS} líneas.`)
      .optional(),
    customerId: z.number().int().positive().nullable().optional(),
    customerName: text(100, 'El nombre del cliente').optional(),
    customerPhone: text(30, 'El teléfono').optional(),
    notes: text(500, 'Las notas del pedido').optional(),
    delivery: z.boolean().optional(),
    deliveryAddress: text(300, 'La dirección de entrega').optional(),
    scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
    discountType: z.enum(['none', 'percent', 'fixed'], { error: 'El tipo de descuento no es válido.' }).optional(),
    discountValue: adjustmentValue.optional(),
    discountReason: text(200, 'El motivo del descuento').optional(),
    tipType: z.enum(['none', 'percent', 'fixed'], { error: 'El tipo de propina no es válido.' }).optional(),
    tipValue: adjustmentValue.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.discountType === 'percent' && value.discountValue !== undefined && value.discountValue > 10000) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'El descuento porcentual no puede superar 100%.',
      });
    }
    if (value.tipType === 'percent' && value.tipValue !== undefined && value.tipValue > 10000) {
      ctx.addIssue({
        code: 'custom',
        path: ['tipValue'],
        message: 'La propina porcentual no puede superar 100%.',
      });
    }
    if (value.items) {
      const keys = new Set();
      value.items.forEach((item, index) => {
        if (keys.has(item.clientKey)) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'clientKey'],
            message: 'El identificador de línea está duplicado.',
          });
        }
        keys.add(item.clientKey);
      });
    }
  });

export const promotionCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, 'Código inválido.'),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(0),
  minSubtotalCents: z.number().int().min(0).optional().default(0),
  maxUses: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: text(300, 'Las notas').optional().default(''),
  autoApply: z.boolean().optional().default(false),
  daysOfWeek: z.string().trim().max(50).optional().default(''),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const promotionUpdateSchema = promotionCreateSchema.partial().refine((value) => Object.keys(value).length > 0, 'Envía al menos un cambio.');

export const publicTableOrderSchema = z.object({
  customerName: text(100, 'El nombre').optional().default(''),
  notes: text(300, 'Las notas').optional().default(''),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(30),
    notes: text(200, 'La nota').optional().default(''),
  })).min(1, 'Agrega al menos un producto.').max(50),
});

export const applyPromotionSchema = z.object({ code: z.string().trim().min(1, 'Ingresa el código.') });

export const giftCardCreateSchema = z.object({
  code: z.string().trim().max(60).optional().default(''),
  amountCents: z.number().int().positive('El monto debe ser positivo.'),
  customerId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: text(300, 'Las notas').optional().default(''),
});

export const giftCardUpdateSchema = z.object({
  active: z.boolean().optional(),
  notes: text(300, 'Las notas').optional(),
}).refine((value) => Object.keys(value).length > 0, 'Envía al menos un cambio.');

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  phone: text(30, 'El teléfono').optional().default(''),
  email: text(120, 'El correo').optional().default(''),
  notes: text(500, 'Las notas').optional().default(''),
});

export const customerUpdateSchema = customerCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un cambio.');

export const reservationCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  phone: text(30, 'El teléfono').optional().default(''),
  partySize: z.number().int().min(1).max(50),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida.'),
  tableId: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  notes: text(500, 'Las notas').optional().default(''),
  status: z.enum(['pending', 'confirmed', 'seated', 'cancelled', 'no_show']).optional().default('pending'),
});

export const reservationUpdateSchema = reservationCreateSchema.partial().refine((value) => Object.keys(value).length > 0, 'Envía al menos un cambio.');

export const waitlistCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  phone: text(30, 'El teléfono').optional().default(''),
  partySize: z.number().int().min(1).max(50),
  quotedMinutes: z.number().int().min(0).max(600).optional().default(0),
  notes: text(500, 'Las notas').optional().default(''),
});

export const waitlistUpdateSchema = z.object({ status: z.enum(['waiting', 'seated', 'cancelled']) });

export const kitchenStationCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(50),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color hexadecimal.').optional().default('#c45d3a'),
  sortOrder: z.number().int().min(-9999).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const kitchenStationUpdateSchema = kitchenStationCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo.');

export const offlineSaleSchema = z.object({
  operationId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/, 'El identificador de sincronización no es válido.'),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  customerName: text(100, 'El nombre del cliente').optional().default(''),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(99),
    notes: text(200, 'La nota').optional().default(''),
  })).min(1, 'Agrega al menos un producto.').max(100),
  cashReceivedCents: z.number().int().positive('El efectivo recibido debe ser positivo.'),
});

export const moveTableSchema = z.object({
  tableId: z.number().int().positive('Selecciona una mesa válida.'),
});

export const transferItemsSchema = z.object({
  targetOrderId: z.number().int().positive('Selecciona un pedido destino.'),
  itemIds: z.array(z.number().int().positive()).min(1, 'Selecciona al menos un producto.').max(100),
});

export const mergeOrderSchema = z.object({
  sourceOrderId: z.number().int().positive('Selecciona un pedido válido.'),
});

export const checkParamsSchema = z.object({ id: z.coerce.number().int().positive(), checkId: z.coerce.number().int().positive() });

export const checkCreateSchema = z.object({
  groups: z.array(z.object({
    label: text(40, 'La etiqueta').optional().default(''),
    shares: z.array(z.object({
      orderItemId: z.number().int().positive(),
      quantityMilli: z.number().int().positive().max(99_000),
    })).min(1).max(100),
  })).min(2).max(20),
});

export const checkEqualSchema = z.object({ count: z.number().int().min(2).max(20) });
export const checkMoveLineSchema = z.object({
  fromCheckId: z.number().int().positive(),
  orderItemId: z.number().int().positive(),
  quantityMilli: z.number().int().positive().max(99_000).optional(),
});
export const checkMergeSchema = z.object({ sourceCheckId: z.number().int().positive(), targetCheckId: z.number().int().positive() });
export const checkTipSchema = z.object({ tipType: z.enum(['none', 'percent', 'fixed']), tipValue: z.number().int().min(0) });

export const splitCreateSchema = z.object({
  groups: z.array(z.object({
    label: text(40, 'La etiqueta de la parte').optional().default(''),
    itemIds: z.array(z.number().int().positive()).min(1, 'Cada parte debe tener al menos un producto.').max(100),
  })).min(2, 'Crea al menos dos partes.').max(20, 'No puedes crear más de 20 partes.'),
});

export const refundSchema = z.object({
  reason: text(300, 'El motivo del reembolso').refine((value) => value.length >= 3, 'Indica el motivo del reembolso.'),
  managerPin: z.string().regex(/^\d{6}$/, 'El PIN del gerente debe tener 6 dígitos.'),
  amountCents: z.number().int().positive('El monto del reembolso debe ser positivo.').optional(),
});

export const courtesySchema = z.object({
  reason: text(200, 'El motivo de la cortesía').refine((value) => value.length >= 3, 'Indica el motivo de la cortesía.'),
});

export const payOrderSchema = z.object({
  splitId: z.number().int().positive('La parte de la cuenta no es válida.').optional(),
  checkId: z.number().int().positive('La cuenta no es válida.').optional(),
  giftCardCode: z.string().trim().max(60).optional(),
  paymentMethod: z
    .string({ error: 'Selecciona un método de pago.' })
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/, 'Selecciona un método de pago válido.'),
  cashReceivedCents: z
    .number({ error: 'El efectivo recibido debe ser un número entero en centavos.' })
    .int('El efectivo recibido debe expresarse en centavos.')
    .min(0, 'El efectivo recibido no puede ser negativo.')
    .max(10_000_000, 'El efectivo recibido es demasiado grande.')
    .optional(),
  amountCents: z
    .number({ error: 'El monto del pago debe ser un número entero en centavos.' })
    .int('El monto del pago debe expresarse en centavos.')
    .positive('El monto del pago debe ser mayor que cero.')
    .max(10_000_000, 'El monto del pago es demasiado grande.')
    .optional(),
});

export const orderListQuerySchema = z.object({
  status: z.enum(['abierta', 'pagada', 'anulada']).optional(),
  type: z.enum(['mesa', 'llevar']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.').optional(),
  source: z.enum(['pos', 'online']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
});

export const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.').optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la categoría es obligatorio.').max(60, 'El nombre no puede exceder 60 caracteres.'),
  description: text(200, 'La descripción').optional().default(''),
  sortOrder: z.number().int('El orden debe ser un entero.').min(-9999).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre de la categoría es obligatorio.').max(60, 'El nombre no puede exceder 60 caracteres.').optional(),
    description: text(200, 'La descripción').optional(),
    sortOrder: z.number().int('El orden debe ser un entero.').min(-9999).max(9999).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');

export const productCreateSchema = z.object({
  categoryId: z.number().int().positive('Selecciona una categoría válida.'),
  stationId: z.number().int().positive().nullable().optional(),
  prepSeconds: z.number().int().min(0).max(7200).optional().default(0),
  isCombo: z.boolean().optional().default(false),
  comboItems: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).max(20).optional().default([]),
  name: z.string().trim().min(1, 'El nombre del producto es obligatorio.').max(80, 'El nombre no puede exceder 80 caracteres.'),
  description: text(300, 'La descripción').optional().default(''),
  priceCents: moneyCents,
  sortOrder: z.number().int('El orden debe ser un entero.').min(-9999).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const productUpdateSchema = z
  .object({
    categoryId: z.number().int().positive('Selecciona una categoría válida.').optional(),
    name: z.string().trim().min(1, 'El nombre del producto es obligatorio.').max(80, 'El nombre no puede exceder 80 caracteres.').optional(),
    description: text(300, 'La descripción').optional(),
    priceCents: moneyCents.optional(),
    stationId: z.number().int().positive().nullable().optional(),
    prepSeconds: z.number().int().min(0).max(7200).optional(),
    isCombo: z.boolean().optional(),
    comboItems: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) })).max(20).optional(),
    sortOrder: z.number().int('El orden debe ser un entero.').min(-9999).max(9999).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');

export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) throw zodToValidationError(result.error);
  return result.data;
}

export function assertValidDate(value) {
  if (value !== undefined && !isValidBusinessDate(value)) {
    throw validationError('La fecha no es válida.', {
      fields: [{ path: 'date', message: 'Usa una fecha real con formato AAAA-MM-DD.' }],
    });
  }
  return value;
}

const STAFF_ROLES = ['owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'];
const PIN_PATTERN = /^\d{4,8}$/;
const NEW_PIN_PATTERN = /^\d{6}$/;

export const loginSchema = z.object({
  staffId: z.number().int().positive('Selecciona un empleado.'),
  pin: z.string().regex(PIN_PATTERN, 'El PIN debe tener entre 4 y 8 dígitos.'),
});

export const setupSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre es demasiado largo.'),
  pin: z.string().regex(NEW_PIN_PATTERN, 'El PIN debe tener exactamente 6 dígitos.'),
  setupToken: z.string().trim().max(200).optional(),
});

export const staffCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre es demasiado largo.'),
  role: z.enum(STAFF_ROLES, { error: 'Selecciona un rol válido.' }),
  pin: z.string().regex(NEW_PIN_PATTERN, 'El PIN debe tener exactamente 6 dígitos.'),
  active: z.boolean().optional().default(true),
});

export const staffUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80, 'El nombre es demasiado largo.').optional(),
    role: z.enum(STAFF_ROLES, { error: 'Selecciona un rol válido.' }).optional(),
    pin: z.string().regex(NEW_PIN_PATTERN, 'El PIN debe tener exactamente 6 dígitos.').optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');

export const areaCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del área es obligatorio.').max(60, 'El nombre es demasiado largo.'),
  sortOrder: z.number().int().min(-9999).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const areaUpdateSchema = areaCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');

export const settingsUpdateSchema = z.object({
  settings: z.record(z.string(), z.string()),
});


export const shiftOpenSchema = z.object({
  openingCents: z.number().int().min(0, 'El fondo inicial no puede ser negativo.').max(10_000_000),
  notes: text(300, 'Las notas').optional().default(''),
});

export const shiftCloseSchema = z.object({
  countedCents: z.number().int().min(0, 'El efectivo contado no puede ser negativo.').max(10_000_000),
  notes: text(300, 'Las notas').optional().default(''),
});

export const kitchenItemUpdateSchema = z.object({
  status: z.enum(['sent', 'preparing', 'ready', 'served'], { error: 'Estado de cocina inválido.' }),
});

export const kitchenTicketUpdateSchema = z.object({
  status: z.enum(['preparing', 'ready', 'served'], { error: 'Estado de cocina inválido.' }),
});

export const modifierOptionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la opción es obligatorio.').max(80),
  priceDeltaCents: z.number().int().min(0).max(100_000).optional().default(0),
  sortOrder: z.number().int().min(-9999).max(9999).optional(),
  active: z.boolean().optional().default(true),
});

export const modifierGroupCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del grupo es obligatorio.').max(80),
  selectionType: z.enum(['single', 'multiple'], { error: 'El tipo de selección no es válido.' }),
  required: z.boolean().optional().default(false),
  minSelect: z.number().int().min(0).max(20).optional().default(0),
  maxSelect: z.number().int().min(1).max(20).optional().default(1),
  sortOrder: z.number().int().min(-9999).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
  options: z.array(modifierOptionSchema).min(1, 'Agrega al menos una opción.').max(50),
});

export const modifierGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    selectionType: z.enum(['single', 'multiple']).optional(),
    required: z.boolean().optional(),
    minSelect: z.number().int().min(0).max(20).optional(),
    maxSelect: z.number().int().min(1).max(20).optional(),
    sortOrder: z.number().int().min(-9999).max(9999).optional(),
    active: z.boolean().optional(),
    options: z.array(modifierOptionSchema).min(1).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');

export const productModifierGroupsSchema = z.object({
  groupIds: z.array(z.number().int().positive()).max(20),
});

export const publicOrderItemSchema = draftItemSchema.omit({ clientKey: true }).extend({
  quantity: z.number().int().min(1).max(30, 'La cantidad máxima en línea es 30.'),
});

export const publicOrderSchema = z
  .object({
    fulfillment: z.enum(['pickup', 'delivery'], { error: 'Selecciona recoger o entrega a domicilio.' }),
    customerName: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
    customerPhone: z.string().trim().min(7, 'El teléfono es obligatorio.').max(30),
    deliveryAddress: text(300, 'La dirección').optional().default(''),
    notes: text(500, 'Las notas').optional().default(''),
    scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
    items: z.array(publicOrderItemSchema).min(1, 'Agrega al menos un producto.').max(50),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillment === 'delivery' && value.deliveryAddress.trim().length < 8) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Escribe una dirección de entrega completa.',
      });
    }
  });

export const tableCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre de la mesa es obligatorio.').max(40),
  capacity: z.number().int().min(1, 'La capacidad mínima es 1.').max(50),
  areaId: z.number().int().positive('Selecciona un área.').nullable().optional(),
  position: z.number().int().min(0).max(9999).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const tableUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    capacity: z.number().int().min(1).max(50).optional(),
    areaId: z.number().int().positive().nullable().optional(),
    position: z.number().int().min(0).max(9999).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');


export const paymentMethodCreateSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'El código no es válido.'),
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(60),
  kind: z.enum(['cash', 'card', 'transfer', 'other']),
  icon: z.string().trim().max(30).optional().default('wallet'),
  allowsPhoto: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
});

export const paymentMethodToggleSchema = z.object({ active: z.boolean() }).strict();

export const paymentMethodUpdateSchema = z
  .object({
    code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'El código no es válido.').optional(),
    name: z.string().trim().min(1).max(60).optional(),
    kind: z.enum(['cash', 'card', 'transfer', 'other']).optional(),
    icon: z.string().trim().max(30).optional(),
    allowsPhoto: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Envía al menos un campo para actualizar.');


export const integrationCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  category: z.enum(['payment', 'accounting', 'delivery', 'loyalty', 'other']).optional().default('other'),
  baseUrl: z.string().trim().max(500).optional().default(''),
  authType: z.enum(['none', 'bearer', 'api_key']).optional().default('none'),
  apiKey: z.string().max(1000).optional().default(''),
  active: z.boolean().optional().default(true),
  notes: z.string().max(1000).optional().default(''),
});

export const integrationUpdateSchema = integrationCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Envía al menos un campo para actualizar.',
);

export const inventoryItemCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  sku: z.string().trim().max(60).optional().default(''),
  unit: z.enum(['g', 'ml', 'pz']),
  minQuantity: z.number().min(0).max(1_000_000).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const inventoryItemUpdateSchema = inventoryItemCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Envía al menos un campo para actualizar.',
);

export const inventoryReceiptSchema = z.object({
  quantity: z.number().positive('La cantidad debe ser mayor que cero.').max(1_000_000),
  costCents: z.number().int().min(0).max(1_000_000_000).optional().default(0),
  reference: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

export const inventoryAdjustmentSchema = z.object({
  countedQuantity: z.number().min(0).max(1_000_000),
  notes: z.string().trim().max(500).optional().default(''),
});

export const recipeSchema = z.object({
  ingredients: z.array(z.object({
    inventoryItemId: z.number().int().positive(),
    quantity: z.number().positive().max(1_000_000),
  })).max(100),
});
