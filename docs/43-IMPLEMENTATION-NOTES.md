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

---

## The zero-cost path

A second build pass made the whole product operable without a bill. Three
mechanisms, each documented in full in `docs/45-RUNNING-AT-ZERO-COST.md`:

### OpenStreetMap discovery

`OverpassAdapter` is a second `SourceAdapter` alongside Google Places. It needs
no API key and no billing account, which Google Places does — the 10,000 free
monthly calls only start after a card is attached to the Cloud project.

The adapter maps about sixty human categories onto OSM tags, fails over across
three public Overpass mirrors, and returns `null` for `rating` and
`reviewCount` because OSM carries neither. Reporting null is the point:
inventing a proxy would be exactly the fabrication this product exists to avoid.
Rating filters therefore do nothing on an OSM campaign, and the wizard says so
on the source card rather than leaving the user to discover it.

`campaign.source` now selects the adapter in `discovery.processor.ts`, and the
persisted `LeadSourceRecord.source` follows the adapter rather than being
hardcoded to `google_places`.

### The `manual` channel

Cold outreach on WhatsApp and Instagram is limited by platform policy, not by
price — and on Instagram the API cannot address a handle at all, at any price.
So `manual` is a first-class channel rather than a fallback: LeadForge does
everything up to the send, then hands the user a `wa.me`, `mailto:` or profile
link, and records the send when they confirm it.

`ManualAdapter.send()` throws deliberately. The outreach worker never reaches
it — `approve()` short-circuits for manual drafts and never enqueues a send job
— and throwing makes an accidental automated send impossible rather than merely
unlikely. `markSentManually()` drives the same state machine as a real send, so
conversations, CRM status, analytics and follow-up sequences all behave
identically from that point on. The `providerMessageId` is `manual:<draftId>`,
which is honest about there being no provider receipt behind it.

### Free models, as a hard filter

`AI_FREE_MODELS_ONLY` restricts routing to models OpenRouter serves at no cost,
so a misconfiguration cannot produce a bill. Four registry models are free _and_
support strict JSON schema output; most free models do not, and a model that
cannot honour the schema fails every task here, so they are absent.

Free models sort **last** among candidates rather than first. Ordering purely on
cost would put a zero-cost model at the head of every chain and quietly
downgrade every paying deployment to a rate-limited model.

---

## Bugs the live runs found

Unit tests, E2E and the HTTP smoke suite all passed while these were broken.
Only running the real thing against real providers surfaced them.

1. **Four of twelve registry model ids no longer existed on OpenRouter.**
   `anthropic/claude-3.5-haiku`, `anthropic/claude-3.7-sonnet`,
   `google/gemini-2.0-flash-001` and a retired free Gemini all returned "model
   is not available". Nothing failed at startup — each failed on the first real
   call for whichever task routed to it. `pnpm check:models` now validates every
   id against the live catalogue and exits non-zero on drift.

2. **Google Places discovery was entirely broken.** The adapter sent a circle
   under `locationRestriction`, which Text Search rejects outright with
   `Unknown name "circle"`; a circle belongs under `locationBias`. Every
   coordinate-targeted Places campaign failed. Bias is also the better
   semantics — it weights towards the area without discarding a business whose
   registered point sits just outside the radius.

3. **Message generation truncated instead of failing.** Reasoning models spend
   the `max_tokens` budget thinking before they emit anything, so a flat 2,000
   cut the JSON off mid-string and surfaced as "not valid JSON" — which sends
   whoever debugs it looking for a schema bug. Budgets are now per task, and a
   `finish_reason: "length"` is reported as truncation with the token count.

4. **A daily quota burned every retry in thirty seconds.** The gateway flattened
   every aggregate failure to `PROVIDER_UNAVAILABLE`, so the worker could not
   tell a rate limit from an outage: five BullMQ attempts, then dead letter,
   while the quota still had hours to run. The aggregate error now carries the
   rate-limit code, and the worker calls `moveToDelayed` instead of consuming an
   attempt. The gateway also no longer sleeps and retries the same model on a
   rate limit — that held a worker slot for up to a minute and never helped.

5. **A campaign's "last activity" was always null.** Pipeline activities carry a
   `campaignId`, but lead-level ones (a note, a status change, a task) do not,
   because a lead can belong to several campaigns. The campaign screen therefore
   showed no activity right after the user had acted on one of its leads. Caught
   by the E2E suite once the pipeline actually ran.

6. **Two tests were passing for the wrong reason.** One asserted "cheapest
   first" using the input rate while the router sorts on whole-call cost — it
   only passed because a zero-cost model happened to sit at the head. Another
   inherited `AI_FREE_MODELS_ONLY` from the developer's `.env`, so its cost
   assertion silently became `0 > 0`. Both now pin what they mean.

---

## Verification performed (second pass)

| Check                        | Result                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                 | All 7 packages/apps build                                                                                                                                              |
| `pnpm typecheck`             | Clean, strict with `noUncheckedIndexedAccess`                                                                                                                          |
| `pnpm lint`                  | Clean, zero warnings tolerated                                                                                                                                         |
| `pnpm format:check`          | Clean                                                                                                                                                                  |
| `pnpm test`                  | 87 unit tests                                                                                                                                                          |
| `pnpm test:e2e`              | 14 tests against real Postgres                                                                                                                                         |
| `pnpm smoke`                 | 68 HTTP assertions                                                                                                                                                     |
| `node scripts/web-smoke.mjs` | 29 assertions in headless Chrome: 21 routes, signup through the real form, no console errors, dark theme, no overflow at 390px                                         |
| `pnpm check:models`          | All 12 registry ids resolve on OpenRouter                                                                                                                              |
| Live OSM campaign            | 5 real Manchester businesses discovered, enriched, verified, analysed and scored                                                                                       |
| Live Places campaign         | 5 real businesses with ratings and review counts, phones normalised to E.164                                                                                           |
| Live manual send             | Evidence-grounded message written by a free model, validation passed, `wa.me` link built, marked sent, conversation opened, analytics updated, double-press idempotent |

The AI half of the pipeline was verified against real OpenRouter calls, not
mocks. `scripts/live-e2e.mjs` reruns the whole thing on demand.
