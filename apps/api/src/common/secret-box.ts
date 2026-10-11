import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption for credentials a workspace hands us (an SMTP password).
 *
 * AES-256-GCM: the tag means a ciphertext that was altered, truncated or moved
 * to another row fails to open rather than decrypting to garbage. The key is
 * derived from the deployment secret with HKDF and a purpose label, so the
 * session secret is never used directly as a cipher key and a second use of
 * this module would get an unrelated key.
 *
 * `context` binds a ciphertext to where it belongs (the workspace and
 * provider). Copying one workspace's stored secret into another's row does not
 * yield a usable password.
 */

const VERSION = 'v1';
const INFO = 'leadforge:integration-secret:v1';

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32));
}

export function sealSecret(plaintext: string, secret: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** @returns the plaintext, or null when the value cannot be opened. */
export function openSecret(sealed: string, secret: string, context: string): string | null {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
