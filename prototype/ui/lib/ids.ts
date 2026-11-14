/** Ключ ідемпотентності команди: формат `^demo-[a-z0-9-]{1,60}$`. */
export function newCommandId(): string {
  if (typeof crypto.randomUUID === 'function') return `demo-${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `demo-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
