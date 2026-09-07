/** URL canonicalisation and domain extraction used by dedupe and enrichment. */

/** Tracking parameters stripped during canonicalisation. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^ref$/i,
  /^igshid$/i,
];

/** Suffixes needing two labels to identify a registrable domain. */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'com.br',
  'co.za',
  'co.in',
  'co.jp',
  'com.mx',
  'com.tr',
  'com.sg',
]);

export interface CanonicalUrl {
  readonly input: string;
  readonly url: string | null;
  readonly origin: string | null;
  readonly hostname: string | null;
  /** Registrable domain, e.g. "example.co.uk". */
  readonly domain: string | null;
  readonly isHttps: boolean;
  readonly valid: boolean;
  readonly reason?: string;
}

const EMPTY: CanonicalUrl = {
  input: '',
  url: null,
  origin: null,
  hostname: null,
  domain: null,
  isHttps: false,
  valid: false,
  reason: 'empty',
};

export function canonicalizeUrl(input: string | null | undefined): CanonicalUrl {
  const raw = (input ?? '').trim();
  if (!raw) return EMPTY;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ...EMPTY, input: raw, reason: 'unparseable' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ...EMPTY, input: raw, reason: 'unsupported_scheme' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname.includes('.') && hostname !== 'localhost') {
    return { ...EMPTY, input: raw, reason: 'invalid_host' };
  }

  parsed.hostname = hostname;
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';

  const params = [...parsed.searchParams.keys()];
  for (const key of params) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();

  // Drop the default port and a single trailing slash on the path.
  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = '';
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }

  return {
    input: raw,
    url: parsed.toString(),
    origin: parsed.origin,
    hostname,
    domain: registrableDomain(hostname),
    isHttps: parsed.protocol === 'https:',
    valid: true,
  };
}

export function registrableDomain(hostname: string | null | undefined): string | null {
  const host = (hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host || !host.includes('.')) return host || null;
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

/** Dedupe key derived from a website URL. */
export function domainKey(input: string | null | undefined): string | null {
  const canonical = canonicalizeUrl(input);
  return canonical.domain;
}

/**
 * True when the host is an IP literal or a name that resolves inside a private
 * range by construction. Full SSRF protection also requires DNS resolution;
 * see the safe-fetch implementation in the API/worker.
 */
export function isObviouslyPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  if (host.includes(':')) return isPrivateIpv6(host);
  return false;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true;
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '::' || host === '::1') return true;
  if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true;
  // IPv4-mapped addresses inherit the IPv4 rules.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

/** Extracts a social handle from a profile URL, e.g. instagram.com/acme -> acme. */
export function socialHandleFromUrl(input: string | null | undefined): string | null {
  const canonical = canonicalizeUrl(input);
  if (!canonical.valid || !canonical.url) return null;
  const path = new URL(canonical.url).pathname.replace(/^\/+|\/+$/g, '');
  if (!path) return null;
  const first = path.split('/')[0] ?? '';
  const handle = first.replace(/^@/, '');
  return /^[A-Za-z0-9._-]{1,60}$/.test(handle) ? handle.toLowerCase() : null;
}
