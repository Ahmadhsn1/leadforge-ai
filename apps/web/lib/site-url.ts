/**
 * The public origin of the site, for absolute URLs in metadata, the sitemap
 * and robots.txt.
 *
 * `NEXT_PUBLIC_APP_URL` wins when set. On Vercel, the production domain is
 * taken from the platform so a deployment that never set the variable does
 * not publish `localhost` links to search engines — which is what a bare
 * fallback did.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}
