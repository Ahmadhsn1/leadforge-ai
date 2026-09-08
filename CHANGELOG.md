# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-09-08

First complete release. The whole pipeline runs end to end against real
providers: discovery, normalisation, enrichment, verification, AI analysis,
scoring, message generation, approval and sending.

### Added

- **OpenStreetMap discovery** (`OverpassAdapter`) — a second source alongside
  Google Places that needs no API key and no billing account. Maps ~60
  categories onto OSM tags and fails over across three public mirrors. Returns
  `null` for rating and review count, which OSM does not carry.
- **Manual outreach channel** — LeadForge writes and validates the message, then
  hands the user a one-click `wa.me` / `mailto` link or copies the body for an
  Instagram DM. Confirming the send drives the same state machine as an
  automated one, so conversations, CRM status, analytics and follow-up sequences
  are unchanged.
- **`AI_FREE_MODELS_ONLY`** — a hard routing filter restricting the gateway to
  models OpenRouter serves at no cost, so a misconfiguration cannot produce a
  bill. Four registry models are free _and_ support strict JSON schema output.
- **`scripts/dev-services.mjs`** — starts Postgres and Redis as native binaries,
  with no Docker or WSL dependency.
- **`scripts/check-models.mjs`** — validates every registry model id against
  OpenRouter's live catalogue and exits non-zero on drift.
- **`scripts/web-smoke.mjs`** — 29 assertions in headless Chrome across 21
  routes, including signup through the real form.
- **`scripts/live-e2e.mjs`** — runs a real campaign against real providers.
- Repository documentation: MIT licence, security policy, contribution guide,
  code of conduct, issue and PR templates, CI, CodeQL, dependency review and
  Dependabot.
- ODbL attribution on the lead detail screen for OpenStreetMap-sourced records.

### Fixed

Six defects that every existing test suite was green through, found only by
running the product against live providers:

- **Four of twelve AI model ids no longer existed on OpenRouter.** They failed
  on the first real call for whichever task routed to them, not at startup.
- **Google Places discovery was entirely broken** — the adapter sent a circle
  under `locationRestriction`, which Text Search rejects; a circle belongs under
  `locationBias`.
- **Message generation truncated silently.** Reasoning models spend the
  `max_tokens` budget before emitting output, so a flat 2,000 cut JSON off
  mid-string and surfaced as "not valid JSON". Budgets are now per task, and a
  `finish_reason: "length"` is reported as truncation.
- **A daily provider quota burned all five retry attempts in thirty seconds.**
  The gateway flattened every aggregate failure to `PROVIDER_UNAVAILABLE`, so a
  rate limit was indistinguishable from an outage. The code now propagates, and
  the worker reschedules the job instead of consuming an attempt.
- **Campaign "last activity" was always null** — lead-level activities carry no
  `campaignId`, because a lead can belong to several campaigns.
- **BullMQ rejected `:` in a custom job id**, so every enqueue threw a 500.

### Changed

- Free models sort **last** among routing candidates rather than first. Ordering
  purely on cost would put a zero-cost model at the head of every chain and
  quietly downgrade every paying deployment to a rate-limited model.
- The gateway no longer retries the same model on a rate limit — that held a
  worker concurrency slot for up to a minute without helping.
- Campaign source defaults to `openstreetmap`.

### Security

- SSRF protection re-validates the target after every redirect hop, refusing
  private, loopback, link-local and cloud-metadata ranges, with byte and
  wall-clock caps.
- Session tokens are opaque, stored as SHA-256, and held in `httpOnly`,
  `SameSite=Lax` cookies proxied same-origin so they never reach client
  JavaScript.
- `organizationId` is always read from the session, never from client input.

[unreleased]: https://github.com/Ahmadhsn1/leadforge-ai/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ahmadhsn1/leadforge-ai/releases/tag/v1.0.0
