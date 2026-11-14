import {resolve} from 'node:path';
import {loadDemoKeys, prepareRuntimeDir} from './config/keys.js';
import {Store} from './db/store.js';
import {createApp} from './http/app.js';
import {runMaintenance} from './workers.js';

/** Звичайний локальний запуск: лише loopback, лише вигадані дані. */

process.umask(0o077);
if (process.env.NODE_ENV === 'production' || (process.env.DEMO_MODE && process.env.DEMO_MODE !== 'true')) {
  throw new Error('synthetic_demo_only');
}

const runtime = prepareRuntimeDir();
const keys = loadDemoKeys(process.env, runtime);
const port = Number(process.env.DEMO_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_demo_port');

const store = new Store(process.env.DEMO_DB_PATH ?? resolve(runtime, 'demo.sqlite'), keys.auditKey);
const server = createApp({store, keys: keys.sources, origin: `http://127.0.0.1:${port}`});

runMaintenance(store, Date.now());
const worker = setInterval(() => {
  try {
    runMaintenance(store, Date.now());
  } catch {
    // Наступний обмежений прохід повторить роботу; стан лишається узгодженим.
  }
}, 1000);
worker.unref();

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Навчальний прототип: http://127.0.0.1:${port}\nЛише вигадані дані. Не офіційний сервіс.\n`);
});

const close = (): void => {
  clearInterval(worker);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
