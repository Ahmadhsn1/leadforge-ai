'use client';

import * as React from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { emailSchema } from '@leadforge/shared';

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/password-reset/request', { email: parsed.data });
    } finally {
      // Always report the same outcome so the form cannot be used to discover
      // which email addresses have accounts.
      setSent(true);
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div
          className="mx-auto flex size-10 items-center justify-center rounded-lg border border-border bg-raised text-primary"
          aria-hidden="true"
        >
          <MailCheck className="size-[18px]" />
        </div>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, we
          have sent a link to reset the password. It expires in one hour.
        </p>
        <Button variant="secondary" className="mt-5 w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the email on your account and we will send you a reset link.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={error} required>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(error)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
