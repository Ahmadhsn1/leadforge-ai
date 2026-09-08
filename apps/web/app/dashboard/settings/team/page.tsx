'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Mail, Trash2, UserPlus } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { qk, useInvites, useMembers, useMe } from '@/lib/queries';
import { ORG_ROLES, ROLE_RANK, type OrgRole } from '@leadforge/shared';
import { formatDate, initials, relativeTime, titleCase } from '@/lib/utils';

const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control, including billing and deleting the workspace.',
  admin: 'Manage campaigns, members, integrations and outreach.',
  member: 'Run campaigns, work leads and approve their own messages.',
  viewer: 'Read-only access to leads, campaigns and analytics.',
};

export default function TeamSettingsPage() {
  const me = useMe();
  const members = useMembers();
  const invites = useInvites();
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<OrgRole>('member');
  const [inviting, setInviting] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  const myRole = me.data?.organization.role ?? 'viewer';
  const canManage = ROLE_RANK[myRole] >= ROLE_RANK.admin;

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      await api.post('/organizations/invites', { email: email.trim().toLowerCase(), role });
      await queryClient.invalidateQueries({ queryKey: qk.invites });
      setEmail('');
      toast.success('Invite sent', { description: `${email} can now join this workspace.` });
    } catch (error) {
      setInviteError(
        error instanceof ApiError && error.status === 409
          ? 'That person is already a member or has a pending invite.'
          : error instanceof ApiError
            ? error.userMessage
            : 'Could not send the invite.',
      );
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(memberId: string, nextRole: OrgRole) {
    try {
      await api.patch(`/organizations/members/${memberId}`, { role: nextRole });
      await queryClient.invalidateQueries({ queryKey: qk.members });
      toast.success('Role updated');
    } catch (error) {
      toast.error('Could not update role', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    }
  }

  async function removeMember(memberId: string, name: string) {
    try {
      await api.delete(`/organizations/members/${memberId}`);
      await queryClient.invalidateQueries({ queryKey: qk.members });
      toast.success(`${name} removed from the workspace`);
    } catch (error) {
      toast.error('Could not remove member', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    }
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <Section
          title="Invite someone"
          description="They will receive a link that expires in seven days."
        >
          <form onSubmit={invite} className="panel flex flex-wrap items-end gap-3 p-4">
            <Field
              label="Email"
              htmlFor="invite-email"
              error={inviteError}
              className="min-w-[220px] flex-1"
            >
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@yourcompany.com"
                leadingIcon={<Mail />}
                invalid={Boolean(inviteError)}
                required
              />
            </Field>
            <Field label="Role" htmlFor="invite-role" className="w-[160px]">
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_ROLES.filter((r) => ROLE_RANK[r] <= ROLE_RANK[myRole]).map((item) => (
                    <SelectItem key={item} value={item} description={ROLE_DESCRIPTIONS[item]}>
                      {titleCase(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" variant="primary" disabled={!email.trim()} loading={inviting}>
              <UserPlus aria-hidden="true" />
              Send invite
            </Button>
          </form>
        </Section>
      ) : null}

      <Section title="Members">
        {members.isLoading ? (
          <CardSkeleton className="h-48" />
        ) : members.isError ? (
          <div className="panel">
            <ErrorState description={members.error.userMessage} onRetry={() => members.refetch()} />
          </div>
        ) : (
          <div className="panel divide-y divide-border">
            {(members.data ?? []).map((member) => {
              const isSelf = member.userId === me.data?.user.id;
              const canEdit = canManage && !isSelf && ROLE_RANK[member.role] < ROLE_RANK[myRole];
              return (
                <div key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar size="md">
                    <AvatarFallback>{initials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {member.name}
                      {isSelf ? (
                        <Badge variant="outline" size="sm">
                          You
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-2xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Tooltip content={ROLE_DESCRIPTIONS[member.role]}>
                    <Badge variant={member.role === 'owner' ? 'primary' : 'outline'}>
                      {titleCase(member.role)}
                    </Badge>
                  </Tooltip>
                  <span className="hidden w-32 text-right text-2xs text-muted-foreground sm:block">
                    {member.lastLoginAt
                      ? `Active ${relativeTime(member.lastLoginAt)}`
                      : 'Never signed in'}
                  </span>
                  {canEdit ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="xs" aria-label={`Manage ${member.name}`}>
                          Manage
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {ORG_ROLES.filter(
                          (r) => ROLE_RANK[r] <= ROLE_RANK[myRole] && r !== member.role,
                        ).map((r) => (
                          <DropdownMenuItem key={r} onSelect={() => changeRole(member.id, r)}>
                            Make {titleCase(r)}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem
                          destructive
                          onSelect={() => removeMember(member.id, member.name)}
                        >
                          <Trash2 />
                          Remove from workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {canManage && invites.data && invites.data.length > 0 ? (
        <Section title="Pending invites">
          <div className="panel divide-y divide-border">
            {invites.data.map((invite) => (
              <div key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{invite.email}</span>
                <Badge variant="outline">{titleCase(invite.role)}</Badge>
                <span className="text-2xs text-muted-foreground">
                  Expires {formatDate(invite.expiresAt)}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    await api.delete(`/organizations/invites/${invite.id}`);
                    await queryClient.invalidateQueries({ queryKey: qk.invites });
                    toast.success('Invite revoked');
                  }}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {!canManage ? (
        <div className="panel">
          <EmptyState
            compact
            title="You cannot manage members"
            description="Ask an admin or the workspace owner to invite people or change roles."
          />
        </div>
      ) : null}
    </div>
  );
}
