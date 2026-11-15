import { serializeCategory, serializeProduct } from './serializers.js';
import { getProductModifierGroups } from './modifiers.js';
import { productStockAvailability } from './inventory.js';
import { featureEnabled } from './features.js';

export function getCatalog(db, config) {
  const categories = db
    .prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name')
    .all();
  const comboEnabled = featureEnabled(db, 'combos');
  const products = db
    .prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE c.active = 1
      ORDER BY c.sort_order, p.sort_order, p.name
    `)
    .all()
    .filter((product) => comboEnabled || !product.is_combo);
  const modifierGroups = getProductModifierGroups(
    db,
    products.map((product) => Number(product.id)),
  );
  const stock = featureEnabled(db, 'inventory_sold_out')
    ? productStockAvailability(db, products.map((product) => Number(product.id)))
    : new Map();
  const byCategory = new Map();
  for (const category of categories) {
    byCategory.set(Number(category.id), {
      ...serializeCategory(category),
      products: [],
    });
  }
  for (const product of products) {
    byCategory.get(Number(product.category_id))?.products.push({
      ...serializeProduct(product),
      modifierGroups: modifierGroups.get(Number(product.id)) ?? [],
      soldOut: Boolean(stock.get(Number(product.id))?.soldOut),
      availableUnits: stock.get(Number(product.id))?.availableUnits ?? null,
    });
  }
  return {
    categories: [...byCategory.values()],
    currency: config.currency,
    taxRateBps: config.taxRateBps,
    timezone: config.timezone,
  };
}
