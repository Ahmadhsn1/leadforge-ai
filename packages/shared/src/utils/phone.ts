/**
 * Phone normalisation to E.164 without pulling a heavyweight metadata library.
 * Covers the calling codes we need for the V1 markets and degrades to
 * "unparseable" rather than guessing.
 */

export interface NormalizedPhone {
  readonly raw: string;
  /** E.164 (e.g. +447700900123) when parseable, otherwise null. */
  readonly e164: string | null;
  readonly countryCode: string | null;
  readonly nationalNumber: string | null;
  readonly valid: boolean;
  readonly reason?: string;
}

/** ISO country -> { callingCode, national number length range, trunk prefix } */
const COUNTRY_RULES: Record<string, { cc: string; min: number; max: number; trunk?: string }> = {
  GB: { cc: '44', min: 9, max: 10, trunk: '0' },
  US: { cc: '1', min: 10, max: 10, trunk: '1' },
  CA: { cc: '1', min: 10, max: 10, trunk: '1' },
  IE: { cc: '353', min: 7, max: 9, trunk: '0' },
  AU: { cc: '61', min: 9, max: 9, trunk: '0' },
  NZ: { cc: '64', min: 8, max: 9, trunk: '0' },
  DE: { cc: '49', min: 9, max: 11, trunk: '0' },
  FR: { cc: '33', min: 9, max: 9, trunk: '0' },
  ES: { cc: '34', min: 9, max: 9 },
  IT: { cc: '39', min: 9, max: 11 },
  NL: { cc: '31', min: 9, max: 9, trunk: '0' },
  PT: { cc: '351', min: 9, max: 9 },
  AE: { cc: '971', min: 8, max: 9, trunk: '0' },
  IN: { cc: '91', min: 10, max: 10, trunk: '0' },
  ZA: { cc: '27', min: 9, max: 9, trunk: '0' },
  NG: { cc: '234', min: 10, max: 10, trunk: '0' },
};

/** Calling codes sorted longest-first so 353 wins over 35 and 3. */
const CALLING_CODES = Array.from(new Set(Object.values(COUNTRY_RULES).map((r) => r.cc))).sort(
  (a, b) => b.length - a.length,
);

function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, '');
}

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry = 'GB',
): NormalizedPhone {
  const original = (raw ?? '').trim();
  if (!original) {
    return {
      raw: original,
      e164: null,
      countryCode: null,
      nationalNumber: null,
      valid: false,
      reason: 'empty',
    };
  }

  // Strip extensions ("x123", "ext. 4") before touching the number itself.
  const withoutExtension = original.replace(/\b(?:ext|x|extension)\.?\s*\d+\s*$/i, '').trim();
  const hasPlus =
    withoutExtension.trimStart().startsWith('+') || withoutExtension.trimStart().startsWith('00');
  const digits = digitsOnly(withoutExtension.replace(/^\s*00/, ''));

  if (digits.length < 6) {
    return {
      raw: original,
      e164: null,
      countryCode: null,
      nationalNumber: null,
      valid: false,
      reason: 'too_short',
    };
  }
  if (digits.length > 15) {
    return {
      raw: original,
      e164: null,
      countryCode: null,
      nationalNumber: null,
      valid: false,
      reason: 'too_long',
    };
  }

  if (hasPlus) {
    const cc = CALLING_CODES.find((code) => digits.startsWith(code));
    if (!cc) {
      // Unknown but well-formed international number: keep it, flag lower trust.
      return {
        raw: original,
        e164: `+${digits}`,
        countryCode: null,
        nationalNumber: digits,
        valid: digits.length >= 8,
        reason: digits.length >= 8 ? 'unknown_calling_code' : 'too_short',
      };
    }
    const national = digits.slice(cc.length);
    return finalize(original, cc, national);
  }

  const rule = COUNTRY_RULES[defaultCountry.toUpperCase()];
  if (!rule) {
    return {
      raw: original,
      e164: null,
      countryCode: null,
      nationalNumber: null,
      valid: false,
      reason: 'unknown_country',
    };
  }

  let national = digits;
  if (rule.trunk && national.startsWith(rule.trunk) && national.length > rule.min) {
    national = national.slice(rule.trunk.length);
  }
  // A local string that already begins with its own calling code (e.g. "44 20 ...").
  if (national.startsWith(rule.cc) && national.length > rule.max) {
    national = national.slice(rule.cc.length);
  }
  return finalize(original, rule.cc, national);
}

function finalize(raw: string, cc: string, nationalInput: string): NormalizedPhone {
  const country = Object.entries(COUNTRY_RULES).find(([, r]) => r.cc === cc);
  let national = nationalInput;
  const rule = country?.[1];
  if (rule?.trunk && national.startsWith(rule.trunk) && national.length > rule.min) {
    national = national.slice(rule.trunk.length);
  }
  const e164 = `+${cc}${national}`;
  const lengthOk = rule
    ? national.length >= rule.min && national.length <= rule.max
    : national.length >= 6;
  return {
    raw,
    e164,
    countryCode: country?.[0] ?? null,
    nationalNumber: national,
    valid: lengthOk,
    reason: lengthOk ? undefined : 'invalid_length',
  };
}

/** Stable dedupe key: E.164 when parseable, otherwise the digit string. */
export function phoneKey(raw: string | null | undefined, defaultCountry = 'GB'): string | null {
  const normalized = normalizePhone(raw, defaultCountry);
  if (normalized.e164) return normalized.e164;
  const digits = digitsOnly(raw ?? '');
  return digits.length >= 6 ? digits : null;
}
