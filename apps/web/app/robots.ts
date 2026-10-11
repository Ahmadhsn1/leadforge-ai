import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * The public pages are indexable; the workspace and the API proxy are not.
 * Those routes also carry `noindex` from the root layout — this is the
 * courteous half, that is the enforced one.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/onboarding', '/api/'] }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
