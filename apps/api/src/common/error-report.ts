import { env } from '@leadforge/config';
import { logger } from './logger';

/**
 * Tells a person when something broke.
 *
 * Structured logs record every failure, but nobody is reading logs at the
 * moment a customer hits a 500. When `ERROR_WEBHOOK_URL` is set, unexpected
 * server errors and permanently failed jobs are posted to it as a short
 * message — the `{ "text": ... }` shape Slack, Discord (`/slack`) and most
 * chat webhooks accept.
 *
 * Deliberately small: no stack traces, request bodies or personal data leave
 * the system, only what failed, where, and the request id to look it up by.
 * It never throws, and it stays quiet about repeats so one broken endpoint
 * cannot flood a channel.
 */

const QUIET_MS = 5 * 60_000;
const recent = new Map<string, number>();

export interface ErrorReport {
  /** Where it happened: "http", or a queue name. */
  readonly source: string;
  /** What was being attempted, such as "POST /campaigns" or a job name. */
  readonly operation: string;
  readonly message: string;
  readonly requestId?: string;
}

/** Whether this report should be sent, given what was sent recently. */
export function shouldReport(key: string, now: number, seen: Map<string, number>): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < QUIET_MS) return false;

  seen.set(key, now);
  // Bounded: forget the oldest entries rather than grow for the process's life.
  if (seen.size > 500) {
    for (const [entry, at] of seen) {
      if (now - at >= QUIET_MS) seen.delete(entry);
    }
  }
  return true;
}

export function formatReport(report: ErrorReport, environment: string): string {
  return [
    `LeadForge error (${environment}) in ${report.source}`,
    `${report.operation}: ${report.message.slice(0, 300)}`,
    report.requestId ? `Request id: ${report.requestId}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function reportError(report: ErrorReport): void {
  const url = env().ERROR_WEBHOOK_URL;
  if (!url) return;
  if (!shouldReport(`${report.source}:${report.operation}`, Date.now(), recent)) return;

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatReport(report, env().APP_ENV) }),
    signal: AbortSignal.timeout(5_000),
  }).catch((error: unknown) => {
    logger('error-report').warn({ err: error }, 'could not deliver error report');
  });
}
