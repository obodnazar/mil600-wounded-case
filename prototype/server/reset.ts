import {existsSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {SEED_DEFINITION, SEED_ID} from './db/migrations.js';

const OWNED_PATHS = ['.runtime/demo.sqlite', '.runtime/e2e.sqlite'];

/**
 * Скидає лише власну навчальну БД: шлях має бути типовим, а файл — містити наш
 * маркер seed. Невідома чи чужа БД не видаляється; ключі в `.runtime` лишаються.
 */
export function resetOwnedDatabase(path: string): void {
  if (process.env.NODE_ENV === 'production' || (process.env.DEMO_MODE && process.env.DEMO_MODE !== 'true')) {
    throw new Error('synthetic_demo_only');
  }
  const owned = OWNED_PATHS.map(item => resolve(item)).includes(resolve(path));
  if (!owned) throw new Error('reset_accepts_owned_demo_only');
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path, {readOnly: true});
  try {
    const marker = db
      .prepare('SELECT id FROM seed_snapshot WHERE id=? AND definition_version=?')
      .get(SEED_ID, SEED_DEFINITION);
    if (!marker) throw new Error('foreign_database_refused');
  } finally {
    db.close();
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, {force: true});
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  if (process.env.DEMO_DB_PATH) throw new Error('reset_accepts_default_demo_only');
  resetOwnedDatabase(resolve('.runtime/demo.sqlite'));
  process.stdout.write('Локальний синтетичний seed буде відновлено на наступному запуску.\n');
}
