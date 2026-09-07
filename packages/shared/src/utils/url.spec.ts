import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  domainKey,
  isObviouslyPrivateHost,
  registrableDomain,
  socialHandleFromUrl,
} from './url';

describe('canonicalizeUrl', () => {
  it('adds a scheme and lowercases the host', () => {
    const result = canonicalizeUrl('WWW.Example.CO.UK/Menu');
    expect(result.valid).toBe(true);
    expect(result.hostname).toBe('www.example.co.uk');
    expect(result.domain).toBe('example.co.uk');
    expect(result.url).toBe('https://www.example.co.uk/Menu');
  });

  it('strips tracking parameters and fragments but keeps real query params', () => {
    const result = canonicalizeUrl('https://example.com/p?utm_source=x&id=7&fbclid=abc#top');
    expect(result.url).toBe('https://example.com/p?id=7');
  });

  it('drops default ports and trailing slashes', () => {
    expect(canonicalizeUrl('https://example.com:443/path/').url).toBe('https://example.com/path');
  });

  it('rejects unsupported schemes and junk', () => {
    expect(canonicalizeUrl('javascript:alert(1)').valid).toBe(false);
    expect(canonicalizeUrl('ftp://example.com').valid).toBe(false);
    expect(canonicalizeUrl('   ').valid).toBe(false);
    expect(canonicalizeUrl('notadomain').valid).toBe(false);
  });

  it('derives the registrable domain for multi-label suffixes', () => {
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('gives the same domain key for equivalent URLs', () => {
    const keys = [
      'http://example.com',
      'https://www.example.com/',
      'example.com/contact?utm_medium=x',
    ].map(domainKey);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('isObviouslyPrivateHost', () => {
  it.each([
    'localhost',
    'app.local',
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (host) => {
    expect(isObviouslyPrivateHost(host)).toBe(true);
  });

  it.each(['example.com', '8.8.8.8', 'sub.example.co.uk'])('allows %s', (host) => {
    expect(isObviouslyPrivateHost(host)).toBe(false);
  });
});

describe('socialHandleFromUrl', () => {
  it('extracts handles', () => {
    expect(socialHandleFromUrl('https://instagram.com/AcmeCoffee/')).toBe('acmecoffee');
    expect(socialHandleFromUrl('instagram.com/@acme.coffee')).toBe('acme.coffee');
  });

  it('returns null when there is no handle', () => {
    expect(socialHandleFromUrl('https://instagram.com')).toBeNull();
    expect(socialHandleFromUrl('rubbish')).toBeNull();
  });
});
