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
