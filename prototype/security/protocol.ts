import {createRequire} from 'node:module';
import type {IncomingMessage} from 'node:http';
import type {Ajv as AjvType} from 'ajv';
import schema from './event.schema.json' with {type: 'json'};
import {Denied} from './core.js';

const require = createRequire(import.meta.url);
const Ajv = require('ajv') as typeof AjvType;
const addFormats = require('ajv-formats') as (ajv: AjvType) => void;

const ajv = new Ajv({allErrors: false, strict: true});
addFormats(ajv);

/** Строга схема конверта й payload для кожного типу події; зайві поля відхиляються. */
export const validateEvent = ajv.compile(schema);

const MAX_BODY_BYTES = 16_384;

export function requestHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

/** Читає тіло запиту: лише `application/json`, без стиснення, не більше 16 КіБ. */
export async function readJsonBody(request: IncomingMessage): Promise<Buffer> {
  if (requestHeader(request, 'content-type') !== 'application/json') throw new Denied(415, 'json_required');
  if (request.headers['content-encoding']) throw new Denied(415, 'encoding_not_supported');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Denied(413, 'body_too_large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
