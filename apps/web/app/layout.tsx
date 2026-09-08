import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
});

const TAGLINE = 'Find the right businesses. Understand them. Start the right conversation.';

const DESCRIPTION =
  'LeadForge researches local businesses, explains why each one is worth contacting with citable evidence, and drafts the message you would actually send.';

export const metadata: Metadata = {
  // Absolute URLs are required for Open Graph. Without a base, Next emits
  // relative image paths and every link preview renders without an image.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: `LeadForge AI — ${TAGLINE}`,
    template: '%s · LeadForge AI',
  },
  description: DESCRIPTION,
  applicationName: 'LeadForge AI',
  authors: [{ name: 'LeadForge AI' }],
  creator: 'LeadForge AI',
  publisher: 'LeadForge AI',
  keywords: [
    'lead generation',
    'sales intelligence',
    'AI prospecting',
    'B2B outreach',
    'lead scoring',
    'local business leads',
  ],
  // The product is a private workspace, so nothing here belongs in a search
  // index. Open Graph is unaffected: a crawler fetching a shared link still
  // reads the card.
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    siteName: 'LeadForge AI',
    title: `LeadForge AI — ${TAGLINE}`,
    description: DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: `LeadForge AI — ${TAGLINE}`,
    description: DESCRIPTION,
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is never disabled.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-palette"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
