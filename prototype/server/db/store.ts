import {DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {auditRecord, type AuditAction, type AuditResult} from '../../security/core.js';
import {openOwnedDatabase, migrate} from './migrations.js';
import {seed} from './seed.js';
import {bootstrap} from './bootstrap.js';

export type Row = Record<string, SQLOutputValue>;
/** Параметр запиту; undefined (відсутня колонка рядка) передається як NULL. */
export type SqlValue = SQLInputValue | undefined;

const bind = (values: SqlValue[]): SQLInputValue[] => values.map(value => value ?? null);

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Єдина точка доступу до локальної SQLite навчального прототипу.
 *
 * Клас навмисно вузький: виконання SQL, транзакційні межі та запис аудиту.
 * Доменні правила, проєкції та HTTP живуть в окремих модулях і отримують Store аргументом.
 */
export class Store {
  readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  constructor(path: string, readonly auditKey: Buffer) {
    if (auditKey.length < 32) throw new Error('invalid_audit_key');
    this.db = openOwnedDatabase(path);
    migrate(this);
    seed(this.db);
    bootstrap(this);
  }

  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  row(sql: string, ...values: SqlValue[]): Row | undefined {
    return this.prepare(sql).get(...bind(values));
  }

  rows(sql: string, ...values: SqlValue[]): Row[] {
    return this.prepare(sql).all(...bind(values));
  }

  run(sql: string, ...values: SqlValue[]): void {
    this.prepare(sql).run(...bind(values));
  }

  /** Число з агрегатного запиту на кшталт `SELECT COUNT(*) AS n …`. */
  count(sql: string, ...values: SqlValue[]): number {
    return Number(this.row(sql, ...values)?.n ?? 0);
  }

  exists(sql: string, ...values: SqlValue[]): boolean {
    return this.row(sql, ...values) !== undefined;
  }

  /** Назви таблиць і колонок приходять лише з коду, значення — лише параметрами. */
  insert(table: string, record: Record<string, SqlValue>): void {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?').join(',');
    this.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, ...Object.values(record));
  }

  /** Атомарна межа: доменний стан, аудит і outbox або записані разом, або не записані зовсім. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Вкладена межа всередині транзакції: помилка відкочує лише роботу savepoint. */
  savepoint<T>(name: string, work: () => T): T {
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = work();
      this.db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO ${name}`);
      this.db.exec(`RELEASE ${name}`);
      throw error;
    }
  }

  /** Аудит без змісту: актор і ресурс зберігаються лише як HMAC-мітки. */
  audit(action: AuditAction, result: AuditResult, actor: string, resource: string, now: number, role = 'source'): void {
    const record = auditRecord(this.auditKey, action, result, actor, resource, now);
    this.run(
      'INSERT INTO audit_entry VALUES (?,?,?,?,?,?,?,?)',
      record.request_id, record.actor_tag, role, record.action,
      record.resource_tag, record.result, record.at, record.request_id,
    );
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }
}
