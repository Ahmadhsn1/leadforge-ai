'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { passwordSchema } from '@leadforge/shared';
import { titleCase } from '@/lib/utils';

interface InvitePreview {
  email: string;
  role: string;
  organizationName: string;
  expiresAt: string;
  hasAccount: boolean;
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get('token') ?? '';

  const preview = useQuery<InvitePreview, ApiError>({
    queryKey: ['invite-preview', token],
    queryFn: () => api.get<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });

  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (!token || preview.isError) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">This invitation did not work</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty" role="alert">
          The link is invalid, has expired, or was already used. Ask the person who invited you to
          send a new one.
        </p>
        <Button variant="primary" size="lg" className="mt-6 w-full" asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (!preview.data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-64" />
        <div className="skeleton h-10 w-full" />
      </div>
    );
  }

  const invite = preview.data;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const fieldErrors: Record<string, string> = {};
    if (!invite.hasAccount) {
      if (!name.trim()) fieldErrors.name = 'Enter your name.';
      const parsed = passwordSchema.safeParse(password);
      if (!parsed.success) {
        fieldErrors.password = parsed.error.issues[0]?.message ?? 'Choose a stronger password.';
      }
    } else if (!password) {
      fieldErrors.password = 'Enter your password.';
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    try {
      await api.post('/auth/invites/accept', {
        token,
        password,
        ...(invite.hasAccount ? {} : { name: name.trim() }),
      });
      await queryClient.invalidateQueries();
      router.replace('/dashboard');
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'That password is not correct.'
          : error instanceof ApiError && error.status === 400
            ? 'This invitation is no longer valid. Ask for a new one.'
            : error instanceof ApiError
              ? error.message
              : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        Join {invite.organizationName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground text-pretty">
        You were invited as <span className="font-medium text-foreground">{invite.email}</span> with
        the {titleCase(invite.role)} role.{' '}
        {invite.hasAccount
          ? 'Enter your LeadForge password to accept.'
          : 'Create your account to accept.'}
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

        {!invite.hasAccount ? (
          <Field label="Your name" htmlFor="name" error={errors.name} required>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              invalid={Boolean(errors.name)}
              required
            />
          </Field>
        ) : null}

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password}
          hint={
            invite.hasAccount
              ? undefined
              : 'At least 12 characters, with upper and lowercase letters and a number.'
          }
          required
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={invite.hasAccount ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={Boolean(errors.password)}
            required
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          {invite.hasAccount ? 'Accept invitation' : 'Create account and join'}
        </Button>
      </form>

      {invite.hasAccount ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">
            Forgot your password?
          </Link>
        </p>
      ) : null}
    </div>
  );
}
