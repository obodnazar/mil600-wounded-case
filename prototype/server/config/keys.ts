import {randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {requireDemoEnvironment, type SourceKey} from '../../security/core.js';
import {SOURCE_SYSTEMS} from '../domain/model.js';

/**
 * Локальні навчальні ключі. Якщо жоден не заданий в оточенні, вони генеруються
 * випадково й зберігаються в приватному `.runtime/local.env` (файл 0600, папка 0700).
 * У репозиторій, браузерний bundle чи відповіді API ключі не потрапляють.
 */

const AUDIT_KEY = 'DEMO_AUDIT_HMAC_KEY';

const SOURCE_KEY_NAMES: Readonly<Record<(typeof SOURCE_SYSTEMS)[number], string>> = {
  'demo-mis': 'DEMO_MIS_HMAC_KEY',
  'demo-sedo': 'DEMO_SEDO_HMAC_KEY',
  'demo-vlk': 'DEMO_VLK_HMAC_KEY',
  'demo-finance': 'DEMO_FINANCE_HMAC_KEY',
  'demo-service': 'DEMO_SERVICE_HMAC_KEY',
  'demo-civil-mis': 'DEMO_CIVIL_HMAC_KEY',
};

const SECRET_NAMES = [...Object.values(SOURCE_KEY_NAMES), AUDIT_KEY];

/** Усі типи подій контракту; глобальна політика «джерело → тип» додатково звужує їх у шлюзі. */
const EVENT_TYPES = new Set([
  'medical.primary_recorded', 'care.admitted', 'care.transferred', 'care.discharged', 'care.start_confirmed',
  'document.prepared', 'document.sent', 'document.issued', 'document.corrected', 'document.withdrawn',
  'document.received', 'referral.issued', 'vlk.package_received', 'vlk.package_returned',
  'vlk.decision_recorded', 'finance.package_received', 'finance.status_recorded',
  'service.action_confirmed', 'source.sync_gap',
]);

export const DEMO_SUBJECTS = new Set(
  Array.from({length: 30}, (_, index) => `demo-person-${String(index + 1).padStart(2, '0')}`),
);

export function prepareRuntimeDir(): string {
  const runtime = resolve('.runtime');
  mkdirSync(runtime, {recursive: true, mode: 0o700});
  chmodSync(runtime, 0o700);
  return runtime;
}

/** Доповнює оточення ключами з приватного файлу, створюючи відсутні. */
function withLocalSecrets(env: NodeJS.ProcessEnv, runtime: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {...env, DEMO_MODE: 'true'};
  if (SECRET_NAMES.some(name => result[name])) return result;
  const file = resolve(runtime, 'local.env');
  const newLine = (name: string): string => `${name}=${randomBytes(32).toString('hex')}`;
  if (!existsSync(file)) {
    writeFileSync(file, `${SECRET_NAMES.map(newLine).join('\n')}\n`, {mode: 0o600, flag: 'wx'});
  }
  const saved = readFileSync(file, 'utf8');
  const missing = SECRET_NAMES.filter(name => !saved.split('\n').some(line => line.startsWith(`${name}=`)));
  if (missing.length) writeFileSync(file, `${saved}${missing.map(newLine).join('\n')}\n`, {mode: 0o600});
  chmodSync(file, 0o600);
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    const [name, value] = line.split('=');
    if (name && value && SECRET_NAMES.includes(name)) result[name] = value;
  }
  return result;
}

export interface DemoKeys {
  auditKey: Buffer;
  sources: Map<string, SourceKey>;
}

export function loadDemoKeys(env: NodeJS.ProcessEnv, runtime: string): DemoKeys {
  const secrets = requireDemoEnvironment(withLocalSecrets(env, runtime), ['DEMO_SERVICE_HMAC_KEY', 'DEMO_CIVIL_HMAC_KEY']);
  const secret = (name: string): Buffer => {
    const value = secrets.get(name);
    if (!value) throw new Error('invalid_secret_configuration');
    return value;
  };
  const sources = new Map<string, SourceKey>();
  for (const source of SOURCE_SYSTEMS) {
    sources.set(source, {
      id: source,
      source,
      secret: secret(SOURCE_KEY_NAMES[source]),
      types: EVENT_TYPES,
      subjects: DEMO_SUBJECTS,
    });
  }
  return {auditKey: secret(AUDIT_KEY), sources};
}

/** Випадкові ключі на час життя процесу — для ізольованого e2e-сервера й тестів. */
export function ephemeralSourceKeys(): Map<string, SourceKey> {
  const sources = new Map<string, SourceKey>();
  for (const source of SOURCE_SYSTEMS) {
    sources.set(source, {id: source, source, secret: randomBytes(32), types: EVENT_TYPES, subjects: DEMO_SUBJECTS});
  }
  return sources;
}
