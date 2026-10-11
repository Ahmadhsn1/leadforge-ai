import { describe, expect, it } from 'vitest';
import { escapeHtml, renderActionEmail } from './email-template';

describe('renderActionEmail', () => {
  const base = {
    heading: 'Verify your email',
    paragraphs: ['Hi Alex,', 'Confirm this address to finish setting up.'],
    actionLabel: 'Verify email',
    actionUrl: 'https://app.example.com/verify-email?token=abc&x=1',
    footnote: 'This link expires in 24 hours.',
  };

  it('includes the heading, every paragraph, the button and the footnote', () => {
    const html = renderActionEmail(base);
    expect(html).toContain('Verify your email');
    expect(html).toContain('Hi Alex,');
    expect(html).toContain('Confirm this address to finish setting up.');
    expect(html).toContain('>Verify email</a>');
    expect(html).toContain('This link expires in 24 hours.');
  });

  it('puts the link in the button and again as text, with ampersands escaped', () => {
    const html = renderActionEmail(base);
    const escaped = 'https://app.example.com/verify-email?token=abc&amp;x=1';
    expect(html.split(`href="${escaped}"`).length - 1).toBe(2);
    expect(html).not.toContain('token=abc&x=1');
  });

  it('escapes a name that contains markup instead of rendering it', () => {
    const html = renderActionEmail({
      ...base,
      paragraphs: ['Hi <img src=x onerror=alert(1)>,'],
      heading: 'Join "Acme" <b>now</b>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>now</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('omits the footnote paragraph when there is none', () => {
    const html = renderActionEmail({ ...base, footnote: undefined });
    expect(html).not.toContain('expires');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter in HTML', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
    );
  });
});
