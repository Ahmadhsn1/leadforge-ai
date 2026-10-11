import { env } from './env';

/**
 * Capability flags derived from configuration. Modules ask these questions
 * instead of reading raw env vars, so a missing integration degrades to a
 * clear "not configured" error rather than a runtime crash deep in a worker.
 */
export interface Capabilities {
  readonly ai: boolean;
  readonly googlePlaces: boolean;
  readonly whatsapp: boolean;
  readonly instagram: boolean;
  readonly email: boolean;
  /** Replies to outreach email are captured into conversations. */
  readonly inboundEmail: boolean;
  /** Self-serve checkout and subscription management. */
  readonly billing: boolean;
  readonly objectStorage: boolean;
  readonly telemetryExport: boolean;
}

export function capabilities(): Capabilities {
  const e = env();
  return {
    ai: e.AI_ENABLED && Boolean(e.OPENROUTER_API_KEY),
    googlePlaces: Boolean(e.GOOGLE_MAPS_API_KEY),
    whatsapp: Boolean(e.META_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    instagram: Boolean(e.META_ACCESS_TOKEN && e.INSTAGRAM_BUSINESS_ACCOUNT_ID),
    email: Boolean(e.SMTP_HOST && e.SMTP_FROM),
    inboundEmail: Boolean(e.INBOUND_EMAIL_DOMAIN && e.INBOUND_EMAIL_SECRET),
    // All-or-nothing: a checkout that takes money but cannot hear the webhook
    // would charge someone and leave them on the free plan.
    billing: Boolean(
      e.PADDLE_API_KEY &&
      e.PADDLE_WEBHOOK_SECRET &&
      e.PADDLE_CLIENT_TOKEN &&
      e.PADDLE_PRICE_STARTER &&
      e.PADDLE_PRICE_GROWTH &&
      e.PADDLE_PRICE_AGENCY,
    ),
    objectStorage: Boolean(e.S3_ENDPOINT && e.S3_BUCKET),
    telemetryExport: Boolean(e.OTEL_EXPORTER_OTLP_ENDPOINT),
  };
}

export function isProduction(): boolean {
  return env().APP_ENV === 'production';
}

export function isTest(): boolean {
  return env().APP_ENV === 'test';
}
