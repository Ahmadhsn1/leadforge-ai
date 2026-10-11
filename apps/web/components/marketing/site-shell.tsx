import Link from 'next/link';
import { Wordmark } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#why', label: 'Why LeadForge' },
  { href: '/pricing', label: 'Pricing' },
];

/**
 * Chrome for the public pages. The app itself is a private workspace with its
 * own shell; this one only has to get a visitor to sign up or sign in.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-sticky border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="rounded-md" aria-label="LeadForge home">
            <Wordmark />
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-5 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* The full nav is hidden on a phone; pricing is the one link worth keeping. */}
            <Button variant="ghost" size="md" className="md:hidden" asChild>
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" size="md" className="hidden sm:inline-flex" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button variant="primary" size="md" asChild>
              <Link href="/signup">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Wordmark />
            <p className="mt-2 max-w-sm text-xs text-muted-foreground text-pretty">
              Business data found through OpenStreetMap is © OpenStreetMap contributors, available
              under the Open Database Licence.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link href="/legal/terms" className="text-muted-foreground hover:text-foreground">
              Terms
            </Link>
            <Link href="/legal/privacy" className="text-muted-foreground hover:text-foreground">
              Privacy
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
