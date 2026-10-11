import { describe, expect, it } from 'vitest';
import { buildWhatsAppPayload, toTemplateParameter } from './whatsapp.adapter';

const request = { recipient: '441615550199', body: 'Hi there.\n\nWorth a quick chat this week?' };
const template = { name: 'first_touch', language: 'en_GB' };

describe('buildWhatsAppPayload', () => {
  it('sends a first message through the approved template', () => {
    const payload = buildWhatsAppPayload(request, template);
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '441615550199',
      type: 'template',
      template: {
        name: 'first_touch',
        language: { code: 'en_GB' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: 'Hi there. Worth a quick chat this week?' }],
          },
        ],
      },
    });
    expect(payload).not.toHaveProperty('text');
  });

  it('sends free-form text once the recipient has replied within the window', () => {
    const payload = buildWhatsAppPayload({ ...request, conversationWindowOpen: true }, template);
    expect(payload).toMatchObject({ type: 'text', text: { body: request.body } });
    expect(payload).not.toHaveProperty('template');
  });

  it('falls back to free-form text when no template is configured', () => {
    const payload = buildWhatsAppPayload(request, { name: undefined, language: 'en' });
    expect(payload).toMatchObject({
      type: 'text',
      text: { preview_url: false, body: request.body },
    });
  });
});

describe('toTemplateParameter', () => {
  it('removes the characters Meta rejects in a parameter', () => {
    expect(toTemplateParameter('one\r\ntwo\tthree     four')).toBe('one two three four');
  });

  it('keeps a parameter within the length limit', () => {
    const result = toTemplateParameter('x'.repeat(2_000));
    expect(result.length).toBeLessThanOrEqual(1_024);
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary single-line message unchanged', () => {
    expect(toTemplateParameter('Worth a quick chat?')).toBe('Worth a quick chat?');
  });
});
