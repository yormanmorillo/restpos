import { loadConfig } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
import { hashPin, assertPinStrength } from '../src/auth.js';

const name = (process.argv[2] || 'Administrador').trim();
const pin = String(process.argv[3] || '').trim();

try {
  assertPinStrength(pin);
} catch (error) {
  console.error('Uso: npm run admin:reset-pin -w server -- "Nombre" "PIN_DE_6_A_8_DIGITOS"');
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
if (existing) {
  db.prepare("UPDATE staff SET role = 'admin', active = 1, pin_hash = ?, updated_at = ? WHERE id = ?")
    .run(hashPin(pin), now, existing.id);
  db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(existing.id);
  db.prepare(`
    INSERT INTO audit_logs (staff_id, action, entity_type, entity_id, details, created_at)
    VALUES (NULL, 'staff.reset_pin_cli', 'staff', ?, 'PIN restablecido desde consola', ?)
  `).run(existing.id, now);
  console.log(`PIN restablecido para ${name} (staff #${existing.id}).`);
} else {
  const result = db
    .prepare(`
      INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at)
      VALUES (?, 'admin', ?, 1, ?, ?)
    `)
    .run(name, hashPin(pin), now, now);
  console.log(`Administrador "${name}" creado con id ${result.lastInsertRowid}.`);
}
db.close();
console.log('Abre /login e inicia sesión con el nuevo PIN.');
