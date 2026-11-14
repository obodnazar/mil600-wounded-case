import {randomBytes} from 'node:crypto';
import {ephemeralSourceKeys} from './config/keys.js';
import {Store} from './db/store.js';
import {createApp} from './http/app.js';
import {runMaintenance} from './workers.js';

/**
 * Окремий процес для браузерних тестів: SQLite у пам'яті, випадкові ключі на час
 * життя процесу, підвищені ліміти лише для швидкого сценарію. Користувацьку
 * `.runtime/demo.sqlite` цей процес не відкриває.
 */
const PORT = Number(process.env.E2E_PORT ?? 4318);
const store = new Store(':memory:', randomBytes(32));
const server = createApp({
  store,
  keys: ephemeralSourceKeys(),
  origin: `http://127.0.0.1:${PORT}`,
  readLimit: 10_000,
  ingressLimit: 10_000,
});
const worker = setInterval(() => runMaintenance(store, Date.now()), 1000);
worker.unref();
server.listen(PORT, '127.0.0.1');

const close = (): void => {
  clearInterval(worker);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
