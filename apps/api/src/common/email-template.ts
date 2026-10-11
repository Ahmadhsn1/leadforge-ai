/**
 * HTML for the product's own emails (verification, password reset, invites).
 *
 * One table-based layout with inline styles, because that is what mail clients
 * render reliably. Every email still carries its plain-text version; this is
 * the same content, easier to act on. Outreach to prospects is not sent
 * through here and stays plain text.
 */

export interface ActionEmail {
  readonly heading: string;
  /** Paragraphs shown above the button. Plain text; escaped here. */
  readonly paragraphs: readonly string[];
  readonly actionLabel: string;
  readonly actionUrl: string;
  /** Small print under the button, such as when the link expires. */
  readonly footnote?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderActionEmail(email: ActionEmail): string {
  const url = escapeHtml(email.actionUrl);
  const paragraphs = email.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#334155;">${escapeHtml(text)}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(email.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px 32px 8px;">
<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#0f172a;">LeadForge <span style="color:#2563eb;">AI</span></p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:#0f172a;">${escapeHtml(email.heading)}</h1>
${paragraphs}
</td></tr>
<tr><td style="padding:4px 32px 24px;">
<a href="${url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;line-height:20px;padding:12px 22px;border-radius:8px;">${escapeHtml(email.actionLabel)}</a>
</td></tr>
<tr><td style="padding:0 32px 28px;">
${email.footnote ? `<p style="margin:0 0 12px;font-size:14px;line-height:20px;color:#64748b;">${escapeHtml(email.footnote)}</p>` : ''}
<p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">If the button does not work, copy this link into your browser:<br><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
