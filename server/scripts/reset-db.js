import { rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDatabase, migrate, seedDatabase } from '../src/db.js';

if (config.databasePath !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(path.resolve(`${config.databasePath}${suffix}`), { force: true });
  }
}
const db = openDatabase(config.databasePath);
migrate(db);
seedDatabase(db);
db.close();
console.log(`Base de datos recreada con datos de ejemplo: ${config.databasePath}`);
