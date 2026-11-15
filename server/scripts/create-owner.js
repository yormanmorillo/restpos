import { loadConfig } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
import { hashPin, assertPinStrength } from '../src/auth.js';

const name = (process.argv[2] || 'Propietario').trim();
const pin = String(process.argv[3] || '').trim();

try {
  assertPinStrength(pin);
} catch (error) {
  console.error(`Uso: npm run owner:create -w server -- "Nombre" "PIN_DE_6_DIGITOS"`);
  console.error(error.message);
  process.exit(1);
}
if (!name || name.length > 80) {
  console.error('El nombre es obligatorio (máximo 80 caracteres).');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);
const now = new Date().toISOString();
const existing = db.prepare('SELECT * FROM staff WHERE name = ?').get(name);
let id;
if (existing) {
  db.prepare("UPDATE staff SET role = 'owner', active = 1, pin_hash = ?, updated_at = ? WHERE id = ?")
    .run(hashPin(pin), now, existing.id);
  id = Number(existing.id);
  db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id);
  console.log(`Propietario actualizado: ${name} (staff #${id}).`);
} else {
  const result = db
    .prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES (?, 'owner', ?, 1, ?, ?)")
    .run(name, hashPin(pin), now, now);
  id = Number(result.lastInsertRowid);
  console.log(`Propietario creado: ${name} (staff #${id}).`);
}
db.prepare(`
  INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
  VALUES (NULL, 'staff.owner_create_cli', 'staff', ?, 'Propietario creado desde consola', ?)
`).run(id, now);
db.close();
console.log('Abre /login e inicia sesión con el PIN del propietario.');
