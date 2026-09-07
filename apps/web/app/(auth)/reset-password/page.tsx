'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { passwordSchema } from '@leadforge/shared';

export default function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Choose a stronger password.');
      return;
    }
    setError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/password-reset/confirm', { token, password: parsed.data });
      router.replace('/login?reset=1');
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 400
          ? 'That reset link is invalid or has expired. Request a new one.'
          : err instanceof ApiError
            ? err.userMessage
            : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset link missing</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          This page needs the token from your reset email. Request a new link and open it directly
          from the email.
        </p>
        <Button variant="primary" className="mt-5 w-full" asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You will be signed out of all other devices.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </div>
        ) : null}

        <Field
          label="New password"
          htmlFor="password"
          error={error}
          required
          hint="At least 12 characters, with upper and lowercase letters and a number."
        >
          <Input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={Boolean(error)}
            required
            trailing={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
              >
                {show ? <EyeOff /> : <Eye />}
              </Button>
            }
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Update password
        </Button>
      </form>
    </div>
  );
}
