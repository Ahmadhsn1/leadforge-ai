'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api-client';
import { signupSchema } from '@leadforge/shared';
import { cn } from '@/lib/utils';

const PASSWORD_RULES = [
  { label: 'At least 12 characters', test: (v: string) => v.length >= 12 },
  { label: 'A lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v: string) => /\d/.test(v) },
];

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = React.useState({
    name: '',
    email: '',
    organizationName: '',
    password: '',
  });
  const [showPassword, setShowPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [touchedPassword, setTouchedPassword] = React.useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      // Move focus to the first field with a problem.
      const firstKey = Object.keys(fieldErrors)[0];
      if (firstKey) document.getElementById(firstKey)?.focus();
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await api.post('/auth/signup', parsed.data);
      await queryClient.invalidateQueries();
      router.replace('/onboarding');
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 409
          ? 'An account already exists with that email. Sign in instead.'
          : error instanceof ApiError
            ? error.userMessage
            : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set up LeadForge in under a minute. You can invite your team later.
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

        <Field label="Your name" htmlFor="name" error={errors.name} required>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={set('name')}
            required
          />
        </Field>

        <Field label="Work email" htmlFor="email" error={errors.email} required>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username email"
            value={form.email}
            onChange={set('email')}
            invalid={Boolean(errors.email)}
            required
          />
        </Field>

        <Field
          label="Workspace name"
          htmlFor="organizationName"
          error={errors.organizationName}
          hint="Usually your agency or company name. Shown to your team."
          required
        >
          <Input
            id="organizationName"
            name="organizationName"
            autoComplete="organization"
            value={form.organizationName}
            onChange={set('organizationName')}
            invalid={Boolean(errors.organizationName)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password} required>
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            onBlur={() => setTouchedPassword(true)}
            invalid={Boolean(errors.password)}
            required
            trailing={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            }
          />
        </Field>

        {/* Requirements are always visible, not revealed only on failure. */}
        <ul className="space-y-1">
          {PASSWORD_RULES.map((rule) => {
            const passed = rule.test(form.password);
            return (
              <li
                key={rule.label}
                className={cn(
                  'flex items-center gap-1.5 text-2xs',
                  passed
                    ? 'text-success'
                    : touchedPassword
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {passed ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <X className="size-3 opacity-40" aria-hidden="true" />
                )}
                {rule.label}
                <span className="sr-only">{passed ? ' — met' : ' — not met'}</span>
              </li>
            );
          })}
        </ul>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Create workspace
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
