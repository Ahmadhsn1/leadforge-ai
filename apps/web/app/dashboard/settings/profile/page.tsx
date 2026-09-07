'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, MailCheck } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { CardSkeleton } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { qk, useMe } from '@/lib/queries';
import { passwordSchema } from '@leadforge/shared';

export default function ProfileSettingsPage() {
  const me = useMe();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  const [savingProfile, setSavingProfile] = React.useState(false);

  React.useEffect(() => {
    if (me.data) setName(me.data.user.name);
  }, [me.data]);

  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [savingPassword, setSavingPassword] = React.useState(false);

  if (me.isLoading) return <CardSkeleton className="h-64" />;

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch('/auth/profile', { name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: qk.me });
      toast.success('Profile updated');
    } catch (error) {
      toast.error('Could not update profile', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? 'Choose a stronger password.');
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: current,
        newPassword: parsed.data,
      });
      setCurrent('');
      setNext('');
      toast.success('Password changed', { description: 'Other sessions have been signed out.' });
    } catch (error) {
      setPasswordError(
        error instanceof ApiError && error.status === 401
          ? 'Your current password is not correct.'
          : error instanceof ApiError
            ? error.userMessage
            : 'Could not change your password.',
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Profile">
        <form onSubmit={saveProfile} className="panel space-y-4 p-4">
          <Field label="Name" htmlFor="profile-name" required>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <Field
            label="Email"
            htmlFor="profile-email"
            hint="Contact support to change the email on your account."
          >
            <Input id="profile-email" value={me.data?.user.email ?? ''} readOnly />
          </Field>

          <div className="flex items-center gap-2">
            {me.data?.user.emailVerified ? (
              <Badge variant="success" className="gap-1">
                <MailCheck className="size-2.5" aria-hidden="true" />
                Email verified
              </Badge>
            ) : (
              <>
                <Badge variant="warning">Email not verified</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    await api.post('/auth/verify-email/resend');
                    toast.success('Verification email sent');
                  }}
                >
                  Resend verification
                </Button>
              </>
            )}
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || name === me.data?.user.name}
              loading={savingProfile}
            >
              Save profile
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Password" description="Changing your password signs out every other session.">
        <form onSubmit={changePassword} className="panel space-y-4 p-4">
          <Field label="Current password" htmlFor="current-password" required>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>

          <Field
            label="New password"
            htmlFor="new-password"
            error={passwordError}
            hint="At least 12 characters, with upper and lowercase letters and a number."
            required
          >
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              invalid={Boolean(passwordError)}
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

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              type="submit"
              variant="primary"
              disabled={!current || !next}
              loading={savingPassword}
            >
              Change password
            </Button>
          </div>
        </form>
      </Section>
    </div>
  );
}
