/** Text normalisation shared by dedupe, matching and validation. */

const BUSINESS_SUFFIXES = [
  'ltd',
  'limited',
  'llc',
  'llp',
  'plc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'bv',
  'sarl',
  'pty',
  'the',
];

/** Lowercase, de-accent, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  return (input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Comparison form of a business name: no punctuation, no legal suffixes,
 * no "the". Used as one of the fuzzy dedupe signals.
 */
export function normalizeBusinessName(input: string | null | undefined): string {
  const base = normalizeText(input)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  const tokens = base.split(' ').filter((token) => token && !BUSINESS_SUFFIXES.includes(token));
  return (tokens.length > 0 ? tokens : base.split(' ')).join(' ');
}

export function normalizeCategory(input: string | null | undefined): string {
  return normalizeText(input).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeAddress(input: string | null | undefined): string {
  return normalizeText(input)
    .replace(/[.,]/g, ' ')
    .replace(/\b(street)\b/g, 'st')
    .replace(/\b(road)\b/g, 'rd')
    .replace(/\b(avenue)\b/g, 'ave')
    .replace(/\b(suite|unit|apartment|apt)\b/g, 'ste')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const value = (input ?? '').trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? value : null;
}

/** Levenshtein distance with an early-exit bound. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0] ?? i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length] ?? 0;
}

/** Normalised similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  const left = a ?? '';
  const right = b ?? '';
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return 1 - levenshtein(left, right) / longest;
}

/** Jaccard similarity over word tokens; robust to reordered names. */
export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

/** Combined name similarity: best of character- and token-level scores. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeBusinessName(a);
  const right = normalizeBusinessName(b);
  if (!left || !right) return 0;
  return Math.max(similarity(left, right), tokenSimilarity(left, right));
}

/** Strips HTML tags and collapses whitespace; used on fetched page content. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(input: string, max: number, suffix = '...'): string {
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

/** Haversine distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
