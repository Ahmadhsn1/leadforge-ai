import { timingSafeEqual } from 'node:crypto';

export { AppError } from '@leadforge/shared';
export { JOB_NAMES } from '@leadforge/shared';

/**
 * Constant-time string comparison that tolerates a length mismatch.
 * `timingSafeEqual` throws on differing lengths, which would itself leak the
 * expected length through the error path.
 */
export function safeEqualOrFalse(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
