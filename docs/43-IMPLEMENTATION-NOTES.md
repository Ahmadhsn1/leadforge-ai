# Implementation Notes

What was built, where the implementation departs from the original documents and
why, and what remains. Written after the V1 build so the next person does not
have to reverse-engineer the reasoning.

---

## Departures from the original documents

Each of these was a deliberate decision, not an oversight.

### 1. The worker boots the API's module graph

`docs/05` lists `apps/worker` as a peer of `apps/api`. It is, as a process — but
it does not reimplement the domain. `apps/worker/src/context.ts` creates a
standalone Nest context from the API's `AppModule` and resolves the services it
needs.

**Why:** verification, scoring, intelligence and outreach are called from both
the HTTP layer (a user clicks "re-analyse") and the queue (the pipeline advances).
Two implementations would drift, and the drift would be invisible until a lead
scored differently depending on which path touched it.

### 2. Score numbers are deterministic; only explanations are AI

`docs/19` defines a `score_lead` schema returning both dimensions and an
explanation. The implementation computes every dimension in `ScoringService`
from stored facts, then asks the model to explain those numbers — and discards
any numbers the model returns.

**Why:** `docs/20` requires the score to be explainable and later recalibrated
against real outcomes. A score that varies between runs on identical inputs
cannot be calibrated, and cannot be defended to a user who asks why a lead
dropped ten points overnight.

### 3. Message validation is two passes, one of which is not a model

`docs/21` requires a quality gate. It is implemented as `MessageValidator` — a
deterministic rule engine with 17 tests — plus an adversarial model check.

**Why:** the rules that matter most (no guaranteed outcomes, no invented
statistics, no pretending to be a customer) must not be talked out of a verdict.
A second model can be. The deterministic pass runs first and its errors are
blocking; the model pass adds nuance the rules cannot express.

### 4. Verification reads the website result rather than fetching it

`docs/12` lists "website reachability" as a verification check. Verification
reads the stored `WebsiteAnalysis`; enrichment owns the fetch and runs first in
the same job.

**Why:** verification stays fast and purely deterministic, and one network fetch
serves both stages instead of two.

### 5. Two extra tables

`MergeCandidate` and `WebhookDelivery` were not in `docs/08`.

- `MergeCandidate` implements the "medium confidence → mark for review" branch
  of `docs/11`, which otherwise had nowhere to live.
- `WebhookDelivery` is the idempotency guard for `docs/23`'s "process
  idempotently" requirement — providers re-deliver, and the delivery row keyed on
  the provider's event ID is what makes a re-delivery a no-op.

### 6. Node-only utilities live behind a subpath export

`@leadforge/shared` exports browser-safe utilities from its root and Node-only
ones (crypto) from `@leadforge/shared/server`.

**Why:** the web bundle would otherwise pull in `node:crypto` and fail to build.
The split makes "can this run in a browser?" a property of the import path.

---

## Where implementation revealed something the documents assumed away

### Instagram cannot cold-start a conversation

`docs/24` describes preparing and sending Instagram messages. In practice, the
Meta API addresses an Instagram-scoped user ID that only exists once that person
has messaged the business account. There is no supported way to open a
conversation with a handle.

The adapter says so explicitly in `validateRecipient`, and the UI surfaces that
reason rather than showing a send button that will always fail. Drafting and
review work fully; sending is available once a conversation exists.

### WhatsApp free-form messages need an open 24-hour window

`docs/23` notes building to Meta's policies. Concretely: outside an active
customer-initiated conversation, only approved template messages are permitted.
The adapter surfaces Meta's rejection with an explanation instead of retrying —
retrying a policy rejection is how accounts get banned.

Template support is the natural next step for cold WhatsApp outreach.

### Email has no reply webhook

`docs/22` assumes `parseWebhook` for every channel. SMTP has no such mechanism.
The email adapter returns `valid: false` from `verifyWebhook` and an empty array
from `parseWebhook` rather than pretending. Capturing email replies needs a
mailbox poller or an inbound-parse provider.

---

## Deliberately not built

- **Payment flow.** Plans and quotas are enforced (`PLAN_QUOTAS`, `UsageCounter`,
  checks in `AiService`, `OutreachService` and `CampaignsService`), but changing
  a plan is an operator action. `docs/37` places billing in Phase 8.
- **Merge review UI.** Candidates are recorded; resolving them needs a query.
- **OpenTelemetry export.** Structured logging with full correlation IDs is in
  place and `OTEL_EXPORTER_OTLP_ENDPOINT` is wired through config, but no
  exporter is registered.
- **AI evaluation dataset.** `docs/34` asks for fixed examples covering
  factuality and schema compliance. The schema-compliance half is covered by the
  gateway tests; the factuality half needs a curated dataset that only real
  campaign output can provide.

---

## Verification performed

| Check            | Result                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm build`     | All 7 packages/apps build                                                                                      |
| `pnpm typecheck` | Clean, strict mode with `noUncheckedIndexedAccess`                                                             |
| `pnpm lint`      | Clean, zero warnings tolerated                                                                                 |
| `pnpm test`      | 83 unit tests                                                                                                  |
| `pnpm test:e2e`  | 14 tests against real Postgres                                                                                 |
| `pnpm smoke`     | 69 HTTP assertions against the running API                                                                     |
| Live pipeline    | Observed: enrichment → verification (probable, 60/100) → scoring (63/100), correlation IDs threaded throughout |
| Tenant isolation | Tested on every read and write path, in both the E2E and smoke suites                                          |

Two real bugs were found and fixed by these tests rather than by inspection:

1. **BullMQ rejects `:` in a custom job ID.** Queue names contain dots and the
   key was joined with a colon, so every enqueue threw a 500. Caught by the
   smoke test's CSV import assertion.
2. **`eslint --fix` broke dependency injection.** The `consistent-type-imports`
   rule rewrote Nest constructor imports as type-only, erasing the runtime class
   reference that `emitDecoratorMetadata` depends on. Caught by the E2E suite
   failing to resolve `Reflector`. The rule is now disabled for `apps/api` and
   `apps/worker`, with the reason recorded in `eslint.config.mjs`.

---

## Reading the code

Start with the pipeline, in execution order:

1. `apps/worker/src/processors/discovery.processor.ts` — discovery and dedupe
2. `apps/api/src/verification/verification.service.ts` — the seven checks
3. `apps/api/src/enrichment/enrichment.service.ts` — safe fetch and signals
4. `apps/api/src/intelligence/intelligence.service.ts` — grounding enforcement
5. `apps/api/src/scoring/scoring.service.ts` — the six dimensions
6. `apps/api/src/personalization/message-validator.ts` — the quality gate
7. `apps/api/src/outreach/outreach.service.ts` — approval, suppression, sending

The AI gateway (`packages/ai/src/gateway.ts`) and router
(`packages/ai/src/router.ts`) are worth reading together: routing policy,
fallback behaviour and schema enforcement are the three things that make model
choice an implementation detail everywhere else.
