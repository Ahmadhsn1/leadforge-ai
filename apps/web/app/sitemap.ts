import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/** Only the pages a search engine should land on. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/legal/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/legal/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
