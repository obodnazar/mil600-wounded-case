import {DatabaseSync} from 'node:sqlite';
import {chmodSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {sha256, type Store} from './store.js';

export const SEED_ID = 'demo-cohort-v1';
export const SEED_DEFINITION = 'seed-1';
const MIGRATIONS_DIR = new URL('../../../db/migrations/', import.meta.url);

/**
 * Відкриває лише власну навчальну БД.
 *
 * Непорожній файл без нашого маркера seed вважається чужим: закриваємо його
 * до будь-якої зміни схеми чи даних.
 */
export function openOwnedDatabase(path: string): DatabaseSync {
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(path, {enableForeignKeyConstraints: true, allowExtension: false});
  if (!isOwnedOrEmpty(db)) {
    db.close();
    throw new Error('foreign_database_refused');
  }
  if (!inMemory) chmodSync(path, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
  return db;
}

function isOwnedOrEmpty(db: DatabaseSync): boolean {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map(table => String(table.name));
  if (!tables.length) return true;
  if (!tables.includes('seed_snapshot') || !tables.includes('schema_migration')) return false;
  const marker = db
    .prepare('SELECT id FROM seed_snapshot WHERE id=? AND definition_version=?')
    .get(SEED_ID, SEED_DEFINITION);
  return marker !== undefined;
}

/** Застосовує нові файли міграцій по одному й звіряє контрольні суми вже застосованих. */
export function migrate(store: Store): void {
  store.db.exec('CREATE TABLE IF NOT EXISTS schema_migration(version TEXT PRIMARY KEY,checksum TEXT NOT NULL) STRICT');
  const files = readdirSync(MIGRATIONS_DIR).filter(name => /^\d{3}-.*\.sql$/.test(name)).sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
    const checksum = sha256(sql);
    const version = file.slice(0, 3);
    const applied = store.row('SELECT checksum FROM schema_migration WHERE version=?', version);
    if (applied && applied.checksum !== checksum) throw new Error('migration_checksum_mismatch');
    if (applied) continue;
    store.transaction(() => {
      store.db.exec(sql);
      store.run('INSERT INTO schema_migration VALUES (?,?)', version, checksum);
    });
  }
}
