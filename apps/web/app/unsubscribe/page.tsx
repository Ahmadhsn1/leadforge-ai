'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';

/**
 * Where an outreach email's opt-out link lands.
 *
 * The visitor is a recipient, not a customer, so there is no product chrome
 * and no pitch — just the one thing they came to do. It takes a click rather
 * than acting on page load, because mail scanners open every link in a message.
 */
export default function UnsubscribePage() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-md p-6">
        <Suspense fallback={<div className="skeleton h-24 w-full" aria-busy="true" />}>
          <UnsubscribeForm />
        </Suspense>
      </div>
    </main>
  );
}

function UnsubscribeForm() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<'idle' | 'working' | 'done' | 'failed'>('idle');

  async function confirm() {
    setState('working');
    try {
      await api.post('/outreach/unsubscribe', { token });
      setState('done');
    } catch {
      setState('failed');
    }
  }

  if (!token) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="mk-body mt-2 text-muted-foreground text-pretty">
          Open the unsubscribe link directly from the email you received, or reply to that email
          asking not to be contacted again.
        </p>
      </>
    );
  }

  if (state === 'done') {
    return (
      <div role="status">
        <h1 className="text-xl font-semibold tracking-tight">You will not be contacted again</h1>
        <p className="mk-body mt-2 text-muted-foreground text-pretty">
          Your details have been added to the sender’s do-not-contact list. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Stop these emails?</h1>
      <p className="mk-body mt-2 text-muted-foreground text-pretty">
        Confirm and the sender will not be able to contact you through this service again.
      </p>
      {state === 'failed' ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          That did not go through. Check your connection and try again.
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        className="mt-5 h-11 w-full"
        loading={state === 'working'}
        onClick={confirm}
      >
        Unsubscribe
      </Button>
    </>
  );
}
