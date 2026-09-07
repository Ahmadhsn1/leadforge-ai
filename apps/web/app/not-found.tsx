import Link from 'next/link';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="max-w-md text-center">
        <div
          className="mx-auto flex size-11 items-center justify-center rounded-lg border border-border bg-raised text-muted-foreground"
          aria-hidden="true"
        >
          <Compass className="size-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">That page does not exist</h1>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
          The link may be stale, or the record may have been merged into another one.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" asChild>
            <Link href="/dashboard">
              <Home aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/dashboard/leads">Browse leads</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
