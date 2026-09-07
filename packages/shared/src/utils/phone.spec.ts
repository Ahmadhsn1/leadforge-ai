import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneKey } from './phone';

describe('normalizePhone', () => {
  it('normalises a UK national number to E.164', () => {
    const result = normalizePhone('020 7946 0958', 'GB');
    expect(result.e164).toBe('+442079460958');
    expect(result.countryCode).toBe('GB');
    expect(result.valid).toBe(true);
  });

  it('normalises a UK mobile with spaces and punctuation', () => {
    expect(normalizePhone('07700 900123', 'GB').e164).toBe('+447700900123');
    expect(normalizePhone('(07700) 900-123', 'GB').e164).toBe('+447700900123');
  });

  it('accepts an already-international number regardless of default country', () => {
    expect(normalizePhone('+44 7700 900123', 'US').e164).toBe('+447700900123');
    expect(normalizePhone('0044 7700 900123', 'US').e164).toBe('+447700900123');
  });

  it('normalises a US number', () => {
    const result = normalizePhone('(415) 555-0132', 'US');
    expect(result.e164).toBe('+14155550132');
    expect(result.valid).toBe(true);
  });

  it('strips extensions', () => {
    expect(normalizePhone('020 7946 0958 ext. 22', 'GB').e164).toBe('+442079460958');
  });

  it('rejects obvious rubbish', () => {
    expect(normalizePhone('12345', 'GB').valid).toBe(false);
    expect(normalizePhone('', 'GB').valid).toBe(false);
    expect(normalizePhone('not a phone', 'GB').valid).toBe(false);
  });

  it('flags an implausible length as invalid but still returns E.164', () => {
    const result = normalizePhone('+44 1', 'GB');
    expect(result.valid).toBe(false);
  });

  it('produces a stable dedupe key across formats', () => {
    const keys = ['+44 7700 900123', '07700900123', '(07700) 900 123', '0044 7700 900123'].map(
      (v) => phoneKey(v, 'GB'),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('+447700900123');
  });
});
