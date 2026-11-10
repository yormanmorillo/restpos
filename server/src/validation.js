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

export const createOrderSchema = z
  .object({
    type: z.enum(['mesa', 'llevar'], { error: 'El tipo de pedido debe ser "mesa" o "llevar".' }),
    tableId: z.number().int().positive('La mesa debe ser un identificador válido.').nullable().optional(),
    customerName: text(100, 'El nombre del cliente').optional().default(''),
    notes: text(500, 'Las notas del pedido').optional().default(''),
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
});

export const draftSchema = z
  .object({
    items: z
      .array(draftItemSchema)
      .max(MAX_LINE_ITEMS, `El pedido no puede tener más de ${MAX_LINE_ITEMS} líneas.`)
      .optional(),
    customerName: text(100, 'El nombre del cliente').optional(),
    notes: text(500, 'Las notas del pedido').optional(),
    discountType: z.enum(['none', 'percent', 'fixed'], { error: 'El tipo de descuento no es válido.' }).optional(),
    discountValue: adjustmentValue.optional(),
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

export const payOrderSchema = z.object({
  paymentMethod: z.enum(['efectivo', 'tarjeta', 'otro'], {
    error: 'Selecciona un método de pago válido.',
  }),
  cashReceivedCents: z
    .number({ error: 'El efectivo recibido debe ser un número entero en centavos.' })
    .int('El efectivo recibido debe expresarse en centavos.')
    .min(0, 'El efectivo recibido no puede ser negativo.')
    .max(10_000_000, 'El efectivo recibido es demasiado grande.')
    .optional(),
});

export const orderListQuerySchema = z.object({
  status: z.enum(['abierta', 'pagada', 'anulada']).optional(),
  type: z.enum(['mesa', 'llevar']).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.').optional(),
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
