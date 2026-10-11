'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';

type State = 'verifying' | 'verified' | 'failed';

export default function VerifyEmailPage() {
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<State>(token ? 'verifying' : 'failed');
  const [message, setMessage] = React.useState<string | null>(null);
  // The token is single-use; React's development double-invoke must not spend
  // it twice and report the second attempt as a failure.
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!token || started.current) return;
    started.current = true;

    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        await queryClient.invalidateQueries();
        setState('verified');
      })
      .catch((error: unknown) => {
        setMessage(error instanceof ApiError && error.status !== 400 ? error.userMessage : null);
        setState('failed');
      });
  }, [token, queryClient]);

  if (state === 'verifying') {
    return (
      <div aria-busy="true">
        <h1 className="text-2xl font-semibold tracking-tight">Confirming your email</h1>
        <p className="mt-1 text-sm text-muted-foreground">This takes a moment.</p>
        <div className="skeleton mt-6 h-10 w-full" />
      </div>
    );
  }

  if (state === 'verified') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Email confirmed</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Your address is verified. You can carry on where you left off.
        </p>
        <Button variant="primary" size="lg" className="mt-6 w-full" asChild>
          <Link href="/dashboard">Go to the dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">This link did not work</h1>
      <p className="mt-1 text-sm text-muted-foreground text-pretty" role="alert">
        {message ??
          'The confirmation link is invalid, has expired, or was already used. Sign in and request a new one from your profile settings.'}
      </p>
      <Button variant="primary" size="lg" className="mt-6 w-full" asChild>
        <Link href="/dashboard/settings/profile">Open profile settings</Link>
      </Button>
    </div>
  );
}
