import { serializeCategory, serializeProduct } from './serializers.js';
import { getProductModifierGroups } from './modifiers.js';

export function getCatalog(db, config) {
  const categories = db
    .prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name')
    .all();
  const products = db
    .prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE c.active = 1
      ORDER BY c.sort_order, p.sort_order, p.name
    `)
    .all();
  const modifierGroups = getProductModifierGroups(
    db,
    products.map((product) => Number(product.id)),
  );
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
    });
  }
  return {
    categories: [...byCategory.values()],
    currency: config.currency,
    taxRateBps: config.taxRateBps,
    timezone: config.timezone,
  };
}
