'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { Section } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Label, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FollowUpTimeline } from '@/components/outreach/follow-up-timeline';
import { CardSkeleton, EmptyState } from '@/components/ui/states';
import { api, ApiError } from '@/lib/api-client';
import { qk, useSequences } from '@/lib/queries';
import { CHANNELS, DEFAULT_SEQUENCE_STEPS, type Channel } from '@leadforge/shared';
import { titleCase } from '@/lib/utils';

interface SequenceStepDraft {
  order: number;
  kind: 'primary' | 'follow_up_1' | 'follow_up_2' | 'final';
  delayHours: number;
  guidance: string;
}

export default function OutreachSettingsPage() {
  const sequences = useSequences();
  const queryClient = useQueryClient();

  return (
    <div className="space-y-6">
      <Section
        title="Follow-up sequences"
        description="One sequence per channel. An approved message starts its campaign's sequence; a reply stops it."
        actions={<CreateSequenceDialog />}
      >
        {sequences.isLoading ? (
          <CardSkeleton className="h-48" />
        ) : sequences.data && sequences.data.length > 0 ? (
          <div className="space-y-4">
            {sequences.data.map((sequence) => (
              <div key={sequence.id} className="space-y-2">
                <FollowUpTimeline sequence={sequence} />
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={async () => {
                      try {
                        await api.delete(`/outreach/sequences/${sequence.id}`);
                        await queryClient.invalidateQueries({ queryKey: qk.sequences });
                        toast.success('Sequence deleted');
                      } catch (error) {
                        toast.error('Could not delete sequence', {
                          description: error instanceof ApiError ? error.userMessage : undefined,
                        });
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              icon={<Ban />}
              title="No sequences yet"
              description="Without a sequence, an approved message sends once and the lead goes quiet. A sequence schedules polite follow-ups and stops the moment they reply."
              action={<CreateSequenceDialog />}
            />
          </div>
        )}
      </Section>

      <Section
        title="Sending safeguards"
        description="These are enforced by the outreach worker and cannot be bypassed from the UI."
      >
        <div className="panel divide-y divide-border">
          <Safeguard
            title="Human approval required"
            detail="Every message waits in the queue until a person approves it. There is no auto-send path in V1."
          />
          <Safeguard
            title="Suppression re-checked before send"
            detail="A do-not-contact record added after approval still blocks the send."
          />
          <Safeguard
            title="Recipient validated by the adapter"
            detail="Each channel adapter validates the recipient format before the provider is called."
          />
          <Safeguard
            title="Idempotent sends"
            detail="Each approved message carries a send idempotency key, so a retried job never sends twice."
          />
          <Safeguard
            title="Provider rate limits respected"
            detail="The outreach queue is rate-limited. Provider 429s cause a delayed retry, never a tighter loop."
          />
        </div>
      </Section>
    </div>
  );
}

function Safeguard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Badge variant="success" className="mt-0.5 shrink-0">
        Enforced
      </Badge>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{detail}</p>
      </div>
    </div>
  );
}

function CreateSequenceDialog() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('Standard follow-up');
  const [channel, setChannel] = React.useState<Channel>('whatsapp');
  const [description, setDescription] = React.useState('');
  const [stopOnReply, setStopOnReply] = React.useState(true);
  const [steps, setSteps] = React.useState<SequenceStepDraft[]>(() =>
    DEFAULT_SEQUENCE_STEPS.map((step) => ({ ...step, guidance: step.guidance ?? '' })),
  );
  const [saving, setSaving] = React.useState(false);
  const queryClient = useQueryClient();

  async function save() {
    setSaving(true);
    try {
      await api.post('/outreach/sequences', {
        name: name.trim(),
        channel,
        description: description.trim() || undefined,
        steps: steps.map((step, index) => ({
          order: index + 1,
          kind: step.kind,
          delayHours: step.delayHours,
          guidance: step.guidance || undefined,
        })),
        stopOnReply,
        stopOnPositive: true,
        active: true,
      });
      await queryClient.invalidateQueries({ queryKey: qk.sequences });
      toast.success('Sequence created');
      setOpen(false);
    } catch (error) {
      toast.error('Could not create sequence', {
        description: error instanceof ApiError ? error.userMessage : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus aria-hidden="true" />
          New sequence
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New follow-up sequence</DialogTitle>
          <DialogDescription>
            Delays are measured from the previous step. Every step still produces a draft you
            approve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Field label="Name" htmlFor="seq-name" required>
              <Input
                id="seq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Channel" htmlFor="seq-channel">
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger id="seq-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {titleCase(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="seq-desc">
            <Textarea
              id="seq-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When to use this sequence"
            />
          </Field>

          <div>
            <Label>Steps</Label>
            <ul className="mt-1.5 space-y-2">
              {steps.map((step, index) => (
                <li
                  key={step.kind}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2.5"
                >
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-2xs font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-[120px] flex-1">
                    <Label htmlFor={`step-kind-${index}`} className="text-2xs">
                      Step
                    </Label>
                    <p id={`step-kind-${index}`} className="mt-1 text-sm">
                      {titleCase(step.kind)}
                    </p>
                  </div>
                  <div className="w-[120px]">
                    <Label htmlFor={`step-delay-${index}`} className="text-2xs">
                      Delay (hours)
                    </Label>
                    <Input
                      id={`step-delay-${index}`}
                      type="number"
                      min={0}
                      value={step.delayHours}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, delayHours: Number(e.target.value) } : s,
                          ),
                        )
                      }
                      className="mt-1 h-8"
                    />
                  </div>
                  <div className="min-w-[200px] flex-[2]">
                    <Label htmlFor={`step-guidance-${index}`} className="text-2xs">
                      Guidance for this step
                    </Label>
                    <Input
                      id={`step-guidance-${index}`}
                      value={step.guidance}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, guidance: e.target.value } : s,
                          ),
                        )
                      }
                      className="mt-1 h-8"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-raised p-3">
            <span>
              <span className="block text-sm font-medium">Stop when they reply</span>
              <span className="block text-xs text-muted-foreground text-pretty">
                Strongly recommended. Continuing to follow up after a reply reads as automation.
              </span>
            </span>
            <Switch checked={stopOnReply} onCheckedChange={setStopOnReply} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={saving} onClick={save}>
            Create sequence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
