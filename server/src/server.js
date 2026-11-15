import { config } from './config.js';
import { openDatabase, migrate, seedDatabase, seedOperationalData, repairTableStatuses, ensureTableQrTokens } from './db.js';
import { createApp } from './app.js';

const db = openDatabase(config.databasePath);
migrate(db);
seedDatabase(db);
seedOperationalData(db);
repairTableStatuses(db);
ensureTableQrTokens(db);

const app = createApp({ db, config });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[api] Casa Roble POS escuchando en http://localhost:${config.port}`);
  console.log(`[api] SQLite: ${config.databasePath}`);
  console.log(`[api] Zona horaria: ${config.timezone} · Impuesto: ${config.taxRateBps / 100}%`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} recibido, cerrando...`);
  server.close(() => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
