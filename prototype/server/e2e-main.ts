import {resolve} from 'node:path';
import {resetOwnedDatabase} from './reset.js';
const path=resolve('.runtime/e2e.sqlite');
resetOwnedDatabase(path);
process.env.DEMO_PORT='4318';
process.env.DEMO_DB_PATH=path;
await import('./main.js');
