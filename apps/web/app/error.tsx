'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the browser console for support; the digest correlates with
    // the server-side log entry.
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="max-w-md text-center">
        <div
          className="mx-auto flex size-11 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <AlertTriangle className="size-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Something broke on this page</h1>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
          The error has been logged. You can retry this view, or go back to the dashboard and carry
          on — your data is unaffected.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-2xs text-muted-foreground">
            Reference: <span className="text-foreground">{error.digest}</span>
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/dashboard">
              <Home aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
