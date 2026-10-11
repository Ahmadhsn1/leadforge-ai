# Production Readiness Plan

What stands between LeadForge and people paying for it, in the order it should
be done. Each phase follows the same loop: **plan → implement → validate**, and
a phase is not done until its validation column is true.

Written 11 October 2026. Status reflects that date.

---

## Who this is for, and why they would pay

**Buyer:** freelancers and small agencies that sell services to local
businesses — web design, SEO, booking systems, marketing.

**Their problem with existing tools:**

| Tool           | Rough price                        | What it leaves undone                         |
| -------------- | ---------------------------------- | --------------------------------------------- |
| D7 Lead Finder | $45–$120 / month                   | A list. No research, no message.              |
| Outscraper     | ~$3 per 1,000 records + enrichment | Raw Google Maps data, pay per use.            |
| Apollo         | ~$49 / user / month                | Broad B2B database; thin on local businesses. |
| Instantly      | ~$30–$47 / month                   | Sends email at volume; you bring the list.    |
| Clay           | ~$134+ / month                     | Powerful enrichment; credits burn fast.       |

Prices are from third-party comparison pages and should be re-checked on each
vendor's own pricing page before they are quoted anywhere public.

The two complaints that come up most about this category are bad contact data
and generic AI copy. Small, targeted sends are also reported to out-reply
blasts by a wide margin. LeadForge's position follows directly: **fewer leads,
each with a checked reason to get in touch and a message written from that
reason.**

**Pricing (working default, not yet tested with customers):**

| Plan    | Price | Leads / mo | Messages / mo | Members |
| ------- | ----- | ---------- | ------------- | ------- |
| Free    | $0    | 100        | 50            | 2       |
| Starter | $29   | 1,000      | 1,000         | 3       |
| Growth  | $79   | 10,000     | 10,000        | 10      |
| Agency  | $199  | 100,000    | 100,000       | 50      |

Starter sits under D7's entry price while doing the research D7 does not.
The single source of truth is `packages/shared/src/constants/plans.ts`.

---

## Phase 1 — Stop the bleeding ✅

Things that were broken or exploitable.

| Gap                                           | Fix                                                                     | Validation                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| Team invites could not be accepted            | `GET /auth/invites/:token`, `POST /auth/invites/accept`, `/invite` page | E2E: create account, single-use, seat limit |
| Email-verification link was a 404             | `/verify-email` page                                                    | Typecheck; manual click-through pending     |
| No API rate limiting                          | Redis fixed-window limiter; tight budget on auth endpoints              | E2E: budget exhausted → denied              |
| CSV import bypassed the lead quota            | Import stops at the allowance and reports skipped rows                  | E2E: 1 created, 2 skipped, then 402         |
| Campaign run could exceed the lead quota      | Run size capped to remaining allowance                                  | Typecheck; covered by quota E2E path        |
| Caller-controlled IP in audit log and limiter | Use proxy-resolved `req.ip`                                             | Typecheck                                   |
| Health screen wrongly said discovery was down | Corrected for OpenStreetMap                                             | Typecheck                                   |

## Phase 2 — Take money ✅ (code) / ⏳ (live verification)

| Gap                               | Fix                                                                     | Validation                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| No way to pay                     | Paddle checkout, plan change, customer portal, webhook → plan           | Unit: signature, price map, entitlement. E2E: signed events upgrade, downgrade, replay, out-of-order |
| Plan features never enforced      | `@RequireFeature` guard; sequences skipped on plans without them        | E2E: 402 on free, allowed after upgrade                                                              |
| A feature sold that did not exist | `white_label` removed from the Agency plan                              | —                                                                                                    |
| Billing screen was a placeholder  | Real status, renewal date, upgrade buttons, portal link, dunning notice | Typecheck; visual check pending                                                                      |

**Still to do before real money:**

1. Create the Paddle account, three prices, and a webhook pointed at
   `<API_URL>/billing/webhook` subscribed to `subscription.*`.
2. Run one sandbox checkout end to end. The code has only met events the test
   suite signed itself; it has not met Paddle.
3. Confirm Paddle onboards the seller's country and entity type. This was
   researched from third-party sources, not confirmed with Paddle.

## Phase 3 — Be findable ✅ (built) / ⏳ (review)

| Gap                        | Fix                                     | Validation                       |
| -------------------------- | --------------------------------------- | -------------------------------- |
| `/` redirected to login    | Landing page                            | Typecheck; browser check pending |
| No pricing page            | `/pricing`, rendered from `PLAN_QUOTAS` | Typecheck; browser check pending |
| No terms or privacy policy | `/legal/terms`, `/legal/privacy`        | **Needs a lawyer's review**      |

Still to do: `sitemap.xml` and `robots.txt`, product screenshots on the landing
page, privacy-friendly analytics on the public pages, a support address.

## Phase 4 — Close the loop on outreach ✅ (code) / ⏳ (provider setup)

| Gap                                     | Fix                                                                                | Validation                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| No unsubscribe link in outreach email   | Signed opt-out link in the body, RFC 8058 one-click headers, `/unsubscribe` page   | Unit: token forgery. E2E: opt-out blocks a send                                      |
| Email replies were never captured       | Signed Reply-To address → `POST /webhooks/inbound-email` → the existing reply path | Unit: address, quote stripping. E2E: Postmark-shaped payload, replay, forged address |
| Notification preferences sent nothing   | `NotificationService` emails verified members on a reply, honouring preferences    | Typecheck; needs SMTP to observe                                                     |
| WhatsApp replies could cross workspaces | A reply goes to the workspace that messaged that number most recently              | Typecheck                                                                            |
| WhatsApp cold outreach needs templates  | **Not built.** Needs a Meta-approved template to build against                     | —                                                                                    |
| Transactional email is plain text only  | **Not built.** Cosmetic; plain text delivers well                                  | —                                                                                    |

Reply capture needs an inbound-parse provider and a domain before it does
anything: set `INBOUND_EMAIL_DOMAIN` and `INBOUND_EMAIL_SECRET`. Postmark's JSON
is the shape the tests use. Mailgun and SendGrid post `multipart/form-data`,
which the API does not parse yet. With capture on, replies arrive in
Conversations rather than in the sender's own mailbox.

## Phase 5 — Earn trust with data ✅ (code) / ⏳ (one screen)

| Gap                                         | Fix                                                                                                         | Validation                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Every customer shared one mailbox           | Each workspace connects its own SMTP account; password sealed with AES-256-GCM                              | Unit: round-trip, tamper, cross-workspace. E2E: validation, no back-door edit |
| No workspace deletion or data export        | Owner-only JSON export; delete on typed name, refused while a subscription is live                          | E2E: export scope, delete cascade, orphaned account removed                   |
| Saving workspace settings wiped preferences | Settings are merged, and the form loads what is stored                                                      | E2E                                                                           |
| Unverified emails could send outreach       | Approval requires a confirmed address, where confirmation email can be delivered                            | Typecheck; needs SMTP to observe                                              |
| No warning before an allowance ran out      | Banner at 80% and at 100%                                                                                   | Typecheck; browser check pending                                              |
| Duplicate review has no screen              | **Not built.** Merging two existing leads moves drafts, conversations and evidence; it needs its own design | —                                                                             |

The mail-server host a customer types is resolved and refused if it points
inside the deployment's own network, and only submission ports are accepted.
The check happens before the connection, not during it, so it narrows that
risk rather than eliminating it.

## Phase 6 — Operate it ⏳

| Gap                               | Plan                                                        | Validation                   |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| No error tracking                 | Sentry, or the OTLP exporter already wired in config        | A forced error shows up      |
| No backups documented             | Managed Postgres with point-in-time recovery; restore drill | A restore actually performed |
| Worker has no free always-on host | Budget for one small paid instance                          | —                            |

CI already runs the unit, E2E, HTTP-smoke and browser-smoke suites on every
push; the browser smoke now covers the public pages too.

## Phase 7 — Go to market ⏳

1. **Ten design-partner users** from freelancer communities, on Growth for
   free in exchange for a weekly call. The pricing above is a guess until they
   react to it.
2. **One vertical first.** "Booking pages for dentists" converts better than
   "leads for anyone", and the landing page example already leans that way.
3. **Content that proves the method**: a public teardown of one researched
   lead, showing the evidence trail. That is the product's difference and it
   demos itself.
4. **Listing sites** (Product Hunt, G2, Capterra) only after the first ten are
   happy enough to review it.

---

## How each phase is validated

| Layer      | Command                      | What it proves                               |
| ---------- | ---------------------------- | -------------------------------------------- |
| Types      | `pnpm typecheck`             | Contracts between packages hold              |
| Lint       | `pnpm lint`                  | Zero warnings                                |
| Unit       | `pnpm test`                  | Pure decisions: validation, routing, billing |
| End to end | `pnpm test:e2e`              | Real Postgres and Redis, real HTTP           |
| HTTP smoke | `pnpm smoke`                 | A running API answers correctly              |
| Browser    | `node scripts/web-smoke.mjs` | Pages render, no console errors, no overflow |
| Live       | `node scripts/live-e2e.mjs`  | Real providers, real models                  |

A change is not "validated" on types and lint alone. The implementation notes
record six bugs that every suite passed while they were live.
