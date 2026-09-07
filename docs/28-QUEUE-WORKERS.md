# Queues & Workers

## Queues

leadforge.discovery
leadforge.normalization
leadforge.verification
leadforge.enrichment
leadforge.intelligence
leadforge.scoring
leadforge.personalization
leadforge.outreach
leadforge.analytics

## Worker rules

- idempotent
- retryable
- observable
- tenant-scoped
- no request-dependent assumptions

## Retry

Transient: exponential backoff.
Rate limit: delayed retry.
Validation failure: limited retry.
Permanent failure: dead-letter.

## Job payload minimum

job_id
organization_id
campaign_id
lead_id
idempotency_key
input_version
