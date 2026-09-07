'use client';

import * as React from 'react';
import { CheckCheck, Instagram, Mail, MessageCircle, Paperclip, Send, Smile } from 'lucide-react';
import { CHANNEL_PROFILES, type Channel } from '@leadforge/shared';
import { cn } from '@/lib/utils';

/**
 * Channel-accurate previews.
 *
 * Seeing the message in the shape the recipient will see it is the fastest way
 * to judge tone and length, so each channel gets its own chrome rather than a
 * generic text box.
 */
export function ChannelPreview({
  channel,
  body,
  subject,
  businessName,
  senderName,
  className,
}: {
  channel: Channel;
  body: string;
  subject?: string | null;
  businessName: string;
  senderName?: string | null;
  className?: string;
}) {
  if (channel === 'whatsapp') {
    return <WhatsAppPreview body={body} businessName={businessName} className={className} />;
  }
  if (channel === 'instagram') {
    return <InstagramPreview body={body} businessName={businessName} className={className} />;
  }
  return (
    <EmailPreview
      body={body}
      subject={subject}
      businessName={businessName}
      senderName={senderName}
      className={className}
    />
  );
}

function WhatsAppPreview({
  body,
  businessName,
  className,
}: {
  body: string;
  businessName: string;
  className?: string;
}) {
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <div className="flex items-center gap-2.5 border-b border-border bg-raised px-3 py-2">
        <span
          className="flex size-7 items-center justify-center rounded-full bg-success/15 text-success"
          aria-hidden="true"
        >
          <MessageCircle className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{businessName}</p>
          <p className="text-2xs text-muted-foreground">WhatsApp Business</p>
        </div>
      </div>

      <div
        className="min-h-[160px] space-y-2 p-3"
        style={{
          backgroundImage: 'radial-gradient(hsl(var(--border) / 0.5) 0.5px, transparent 0.5px)',
          backgroundSize: '14px 14px',
        }}
      >
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg rounded-tr-sm border border-success/20 bg-success/10 px-2.5 py-1.5 shadow-subtle">
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {body || 'Your message will appear here.'}
            </p>
            <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
              {time}
              <CheckCheck className="size-3" aria-hidden="true" />
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-muted-foreground">
        <Smile className="size-3.5" aria-hidden="true" />
        <span className="flex-1 text-2xs">Message</span>
        <Send className="size-3.5" aria-hidden="true" />
      </div>
    </div>
  );
}

function InstagramPreview({
  body,
  businessName,
  className,
}: {
  body: string;
  businessName: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2">
        <span
          className="flex size-7 items-center justify-center rounded-full bg-gradient-to-tr from-warning to-destructive text-background"
          aria-hidden="true"
        >
          <Instagram className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{businessName}</p>
          <p className="text-2xs text-muted-foreground">Instagram · Direct</p>
        </div>
      </div>

      <div className="min-h-[140px] p-3">
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {body || 'Your message will appear here.'}
            </p>
          </div>
        </div>
        <p className="mt-1 text-right text-[10px] text-muted-foreground">Sent</p>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-muted-foreground">
        <span className="flex-1 rounded-full border border-border px-2.5 py-1 text-2xs">
          Message…
        </span>
      </div>
    </div>
  );
}

function EmailPreview({
  body,
  subject,
  businessName,
  senderName,
  className,
}: {
  body: string;
  subject?: string | null;
  businessName: string;
  senderName?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <div className="flex items-center gap-2.5 border-b border-border bg-raised px-3 py-2">
        <span
          className="flex size-7 items-center justify-center rounded-md bg-info/15 text-info"
          aria-hidden="true"
        >
          <Mail className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{subject || 'No subject yet'}</p>
          <p className="truncate text-2xs text-muted-foreground">
            From {senderName ?? 'you'} · To {businessName}
          </p>
        </div>
      </div>

      <div className="min-h-[180px] p-4">
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
          {body || 'Your message will appear here.'}
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        <Paperclip className="size-3.5" aria-hidden="true" />
        Plain text · no tracking pixels
      </div>
    </div>
  );
}

/** Live length meter against the channel's target and hard cap. */
export function LengthMeter({ channel, body }: { channel: Channel; body: string }) {
  const profile = CHANNEL_PROFILES[channel];
  const length = body.length;
  const overCap = length > profile.maxLength;
  const overTarget = length > profile.targetLength;
  const pct = Math.min(100, (length / profile.maxLength) * 100);

  return (
    <div className="flex items-center gap-2">
      <span className="h-1 w-20 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className={cn(
            'block h-full rounded-full transition-[width,background-color] duration-300',
            overCap ? 'bg-destructive' : overTarget ? 'bg-warning' : 'bg-success',
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={cn(
          'tabular text-2xs',
          overCap
            ? 'font-medium text-destructive'
            : overTarget
              ? 'text-warning'
              : 'text-muted-foreground',
        )}
      >
        {length} / {profile.maxLength}
        {overCap ? ' — too long to send' : overTarget ? ' — longer than ideal' : ''}
      </span>
    </div>
  );
}
