import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';

// AES-256-GCM. The key is derived from API_KEYS_SECRET (preferred) or JWT_SECRET. Without either,
// saving is refused rather than storing keys in plain text.
function secret(): Buffer {
  const s = process.env.API_KEYS_SECRET || process.env.JWT_SECRET;
  if (!s) {
    throw new BadRequestException('Set API_KEYS_SECRET (any long random text) in the server environment before saving customer API keys.');
  }
  return createHash('sha256').update(s).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secret(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decryptJson<T = Record<string, string>>(blob: string | null): T | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split(':');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')) as T;
  } catch {
    return null; // wrong secret or corrupted - treated as "not set"
  }
}
