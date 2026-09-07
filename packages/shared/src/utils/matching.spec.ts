import { describe, expect, it } from 'vitest';
import { matchCandidates } from './matching';
import { normalizeBusinessName, nameSimilarity } from './text';

describe('normalizeBusinessName', () => {
  it('drops legal suffixes and punctuation', () => {
    expect(normalizeBusinessName('The Bloom & Co. Ltd')).toBe('bloom and');
    expect(normalizeBusinessName('ACME Coffee Limited')).toBe('acme coffee');
  });

  it('is stable across casing and accents', () => {
    expect(normalizeBusinessName('Café Néro')).toBe(normalizeBusinessName('CAFE NERO'));
  });

  it('never returns empty for a suffix-only name', () => {
    expect(normalizeBusinessName('Ltd')).toBe('ltd');
  });
});

describe('nameSimilarity', () => {
  it('scores reordered names highly via tokens', () => {
    expect(nameSimilarity('Bloom Coffee House', 'Coffee House Bloom')).toBeGreaterThan(0.9);
  });

  it('scores unrelated names low', () => {
    expect(nameSimilarity('Bloom Coffee', 'Sunset Plumbing')).toBeLessThan(0.4);
  });
});

describe('matchCandidates', () => {
  it('auto-merges on identical phone plus consistent name', () => {
    const result = matchCandidates(
      { name: 'Bloom Coffee', phone: '020 7946 0958', country: 'GB' },
      { name: 'Bloom Coffee Ltd', phone: '+442079460958', country: 'GB' },
    );
    expect(result.decision).toBe('merge');
    expect(result.signals.phone).toBe(1);
  });

  it('auto-merges on identical domain plus consistent name', () => {
    const result = matchCandidates(
      { name: 'Bloom Coffee', website: 'https://bloomcoffee.co.uk' },
      { name: 'Bloom Coffee House', website: 'http://www.bloomcoffee.co.uk/menu' },
    );
    expect(result.decision).toBe('merge');
  });

  it('will not merge on name alone', () => {
    const result = matchCandidates({ name: 'Bloom Coffee' }, { name: 'Bloom Coffee' });
    expect(result.decision).not.toBe('merge');
  });

  it('keeps clearly different businesses distinct', () => {
    const result = matchCandidates(
      { name: 'Bloom Coffee', phone: '020 7946 0958', website: 'https://bloomcoffee.co.uk' },
      { name: 'Sunset Plumbing', phone: '020 7946 1111', website: 'https://sunsetplumbing.com' },
    );
    expect(result.decision).toBe('distinct');
  });

  it('flags a close-but-unproven pair for review', () => {
    const result = matchCandidates(
      { name: 'Bloom Coffee', address: '12 High Street, London', latitude: 51.5, longitude: -0.12 },
      {
        name: 'Bloom Coffee House',
        address: '12 High St, London',
        latitude: 51.5001,
        longitude: -0.1201,
      },
    );
    expect(result.decision).toBe('review');
  });

  it('returns distinct when there is nothing to compare', () => {
    expect(matchCandidates({}, {}).decision).toBe('distinct');
  });
});
