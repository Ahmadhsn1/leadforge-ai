# LeadForge AI

AI prospect intelligence and outreach. Find the right businesses, understand them,
and start the right conversation.

LeadForge runs the research a good salesperson would do — discovery, verification,
enrichment, analysis, scoring and message drafting — and shows the evidence behind
every recommendation. Nothing is sent without a human approving it.

---

## What it does

```
Discovery → Normalisation → Verification → Enrichment → Evidence
          → AI Intelligence → Scoring → Personalisation
          → Outreach Queue → Conversations → CRM → Analytics
```

Each stage is an idempotent background job. Each writes evidence. Each is visible
in the UI while it runs.

**The product principle that shapes everything:** evidence before claims. A pain
point the AI reports links to a stored observation with a source, a timestamp and
a confidence value. Verification is deterministic and provider-backed — a lead is
never marked verified because a model said so. A message citing a statistic the
evidence cannot support fails validation and cannot be approved.

---

## Quick start

Requirements: Node 20+, pnpm 11+, Docker.

```bash
# 1. Configuration
cp .env.example .env
# Generate a real secret:
node -e "console.log('AUTH_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
# …and paste it into .env

# 2. Datastores (Postgres on 5462, Redis on 6389 — offset to avoid clashes)
pnpm docker:up

# 3. Install, migrate, seed
pnpm install
pnpm db:migrate
pnpm db:seed

# 4. Run everything
pnpm dev
```

Then open **http://localhost:3000** and sign in with the seeded account:

```
demo@leadforge.local  /  LeadForgeDemo123
```

The seed creates one workspace with four leads at different pipeline stages, an
analysed lead with evidence-backed pain points, a draft awaiting approval, and a
live conversation — so every screen has something real to render.

To run the whole stack in containers instead: `pnpm stack:up`.

---

## Providers

LeadForge does not simulate integrations. An unconfigured provider reports that
plainly; it never returns invented data. Everything except the two marked
**required for full function** degrades gracefully.

| Provider                      | Environment variables                                                                           | Without it                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenRouter** — AI gateway   | `OPENROUTER_API_KEY`                                                                            | Analysis, score explanations, message generation and the copilot return "not configured". Verification, enrichment and deterministic scoring still work. |
| **Google Places** — discovery | `GOOGLE_MAPS_API_KEY`                                                                           | Campaigns cannot discover businesses. CSV import still works and runs the full pipeline.                                                                 |
| WhatsApp Business             | `META_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | Drafts can be written and reviewed but not sent.                                                                                                         |
| Instagram                     | `META_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`                                            | As above. Note that Instagram does not permit cold-starting a conversation — see below.                                                                  |
| Email (SMTP)                  | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`                                          | Email outreach cannot send; verification and reset emails are logged instead.                                                                            |

Where to get each key is linked in **Settings → Integrations** inside the app.

### Platform limits that are honoured, not worked around

- **WhatsApp:** free-form messages are only permitted inside an active 24-hour
  conversation window. Outside it, Meta requires an approved template. The
  adapter surfaces that rejection rather than retrying into a ban.
- **Instagram:** a business account cannot open a conversation with an arbitrary
  handle. Drafts can be prepared, but sending is only possible after the person
  messages you first. The UI says so instead of pretending otherwise.
- There is no login automation, no account rotation, no scraping of private data
  and no anti-bot evasion anywhere in this codebase.

---

## Architecture

```
apps/
  web/        Next.js 15 App Router. Talks only to /api on its own origin,
              which proxies to the API with the session cookie attached.
  api/        NestJS. HTTP boundary, auth, tenancy, orchestration, webhooks.
  worker/     BullMQ processors. Boots the API's module graph, so the pipeline
              has exactly one implementation.
packages/
  shared/     Types, Zod schemas, domain vocabulary, normalisation utilities.
  database/   Prisma schema, migrations, client.
  ai/         AI gateway, model router, versioned prompts, output schemas.
  config/     Typed, validated environment configuration.
infra/docker/ Container definitions for all three services.
```

### Decisions worth knowing

**The worker runs the API's services.** It boots `AppModule` as a standalone
Nest context rather than reimplementing verification, scoring or outreach. A
behaviour that differs between API and worker is therefore impossible.

**Scores are deterministic; explanations are AI.** The six dimensions are
computed from stored facts in `ScoringService`. The model is asked to explain
them, never to produce them — a score that changes because a model was in a
different mood is not a score anyone can act on.

**Two independent validation passes on every message.** A deterministic rule
engine (`MessageValidator`) that cannot be argued with, plus an adversarial model
check. Both results are stored on the draft so a reviewer sees exactly why
something was flagged.

**The browser never holds a token.** The session is an opaque random value in an
httpOnly cookie; only its SHA-256 is stored. The web app proxies same-origin, so
there is no cross-origin cookie handling and no token in client JavaScript.

**SSRF protection on every outbound fetch.** A lead's website URL comes from a
public directory listing that anyone can edit. Hostnames are resolved and every
returned address is checked against private ranges, redirects are followed
manually and re-validated per hop, with hard timeout and byte caps.

**Idempotency is structural.** Every job carries a deterministic idempotency key
and writes a `JobRecord` keyed on `(queue, idempotencyKey)`. A duplicate enqueue
is a no-op; a retried send finds the draft already sent and stops.

---

## Commands

```bash
pnpm dev              # web + api + worker in watch mode
pnpm dev:api          # one service at a time
pnpm build            # build everything, packages first
pnpm typecheck        # tsc across the workspace
pnpm lint             # eslint, zero warnings tolerated
pnpm format           # prettier
pnpm test             # unit tests (83)
pnpm test:e2e         # end-to-end against a real database (14)
pnpm smoke            # HTTP smoke test against a running API (69 assertions)

pnpm db:migrate       # create and apply a migration
pnpm db:seed          # development data
pnpm db:studio        # Prisma Studio

pnpm docker:up        # postgres + redis
pnpm stack:up         # the whole stack in containers
```

---

## Testing

| Layer                    | What it covers                                                                           | Count |
| ------------------------ | ---------------------------------------------------------------------------------------- | ----- |
| `packages/shared`        | Phone/URL normalisation, dedupe matching, similarity                                     | 41    |
| `packages/ai`            | Model routing, fallback, schema validation, usage accounting                             | 25    |
| `apps/api` (unit)        | Message validation — every prohibited-claim rule                                         | 17    |
| `apps/api` (e2e)         | Full pipeline against real Postgres: dedupe, verification, scoring, suppression, tenancy | 14    |
| `scripts/smoke-test.mjs` | Live HTTP surface: auth, contracts, guards, tenant isolation                             | 69    |

Tenant isolation is tested explicitly on every read and write path, per the
definition of done in `docs/38`.

---

## Security

- Argon2id password hashing; opaque session tokens, hashed at rest
- Every organisation-scoped query takes its tenant from the session, never from
  the request — there is no code path that accepts an organisation ID from a client
- Role hierarchy enforced by guard: `owner > admin > member > viewer`
- Webhook signatures verified with a constant-time HMAC comparison; unverified
  payloads are discarded
- Secrets never reach the client, the logs (redacted by the logger) or the audit
  trail (stripped by the audit service)
- Suppression is checked at queue time **and again immediately before sending**

---

## Documentation

`docs/` is the source of truth for product and engineering decisions and is
numbered in reading order. Per `docs/39`, an architecture change updates the
relevant document before the implementation continues.

`docs/43-IMPLEMENTATION-NOTES.md` records what was built, where the
implementation departs from the original design and why, and what platform
limits turned out to constrain the product (Instagram cannot cold-start a
conversation; WhatsApp free-form messages need an open 24-hour window).

---

## Current limitations

Stated plainly, because the alternative is discovering them later:

- **Billing is not wired up.** Plans and quotas are enforced from the workspace's
  plan record; changing a plan is an operator action. There is no payment flow.
- **Inbound email replies are not ingested.** SMTP has no webhook; WhatsApp and
  Instagram replies arrive by webhook and are fully handled. Email reply capture
  needs a mailbox poller or an inbound-parse provider.
- **Instagram sending requires an inbound message first** — a platform rule, not
  an implementation gap.
- **CSV is the only import format**, and the only discovery source is Google
  Places. Both sit behind adapter interfaces, so adding another is a new adapter
  rather than a change to the pipeline.
- **Merge review is recorded but has no UI.** Medium-confidence duplicate pairs
  are written to `merge_candidates`; resolving them currently needs a database
  query.
