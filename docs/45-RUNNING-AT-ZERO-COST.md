# Running LeadForge at Zero Cost

Every part of this product can run without a bill. This document says exactly
how, and — more usefully — exactly where the free path stops being free, so you
find out here rather than three weeks into a campaign.

Checked September 2026. Free tiers move; re-check before relying on a number.

---

## The short version

| Piece          | Free option                   | Costs money when                          |
| -------------- | ----------------------------- | ----------------------------------------- |
| Lead discovery | OpenStreetMap (Overpass)      | You want ratings and review counts        |
| AI             | OpenRouter `:free` models     | You exceed ~50 calls/day, or want quality |
| Outreach       | `manual` channel              | You want automated sending at volume      |
| Postgres       | Neon free, or local           | Over 0.5 GB or 100 compute-hours/month    |
| Redis          | Local                         | You want it hosted and always-on          |
| Web hosting    | Vercel Hobby                  | Commercial use under their terms          |
| API + worker   | **A machine you already own** | You want it in the cloud, always-on       |

The last row is the one that matters, and it is covered honestly below.

---

## 1. Discovery: OpenStreetMap instead of Google Places

Set the campaign source to `openstreetmap`. It is the default in the campaign
wizard.

- **No API key, no billing account, no card.** Google Places gives 10,000 free
  Essentials calls a month, but only after you attach a payment method to a
  Google Cloud project.
- OSM data is free to use under the [ODbL][odbl]. Attribution is required
  wherever OSM-sourced leads are displayed; the lead detail screen carries it.
- Public Overpass instances tolerate a few hundred queries a day. The adapter
  fails over across three mirrors and reports `rateLimited` rather than
  hammering one.

**What you give up:** OSM has no ratings and no review counts. The adapter
returns `null` for both rather than inventing a proxy, so rating and
review-count filters do nothing on an OSM campaign. Verify this matters to you
before switching — for "independent businesses with no website", which is the
core ICP, it usually does not.

**What you gain:** OSM is unusually good at exactly that ICP. A live query for
Manchester restaurants returned 15 businesses, 9 of them named with no website
recorded at all.

---

## 2. AI: free models on OpenRouter

```bash
AI_FREE_MODELS_ONLY=true
```

This is a hard filter in the router, not a preference. With it on, a paid model
is never called, so a misconfiguration cannot produce a bill.

Four models in the registry are genuinely free _and_ support strict JSON schema
output, which every task here requires:

| Model                                    | Tier     | Context |
| ---------------------------------------- | -------- | ------- |
| `openrouter/free`                        | economy  | 200k    |
| `liquid/lfm-2.5-2.6b:free`               | economy  | 65k     |
| `dots-studio/dots-3-note-preview:free`   | balanced | 512k    |
| `nvidia/nemotron-3-super-120b-a12b:free` | quality  | 262k    |

Most free models on OpenRouter do **not** support structured outputs, and are
deliberately absent from the registry: a model that cannot honour the schema
fails every task in this product, so listing it would only move the failure
later. `pnpm check:models` verifies every id against the live catalogue.

### The real limit is requests per day, not tokens

OpenRouter's free tier allows roughly **50 requests per day** on an account with
no credit, rising to about 1,000/day once the account has ever purchased $10 of
credit. That is the binding constraint.

A single lead costs about three AI calls — analysis, score narrative, message.
So **50 calls/day is roughly 16 fully-processed leads per day** on a fresh
account. Discovery, normalisation, verification, enrichment and scoring are all
deterministic and cost nothing, so those keep working regardless.

When the quota is exhausted the worker does not fail the job. It reschedules it
15 minutes out without consuming a retry attempt, so the work resumes on its own
when the window reopens rather than dead-lettering while the quota is still
spent.

**Quality note, stated plainly:** free models are weaker. The message they write
is decent and grounded in the same evidence, but if you are sending to leads you
care about, a few dollars of OpenRouter credit buys noticeably better copy.
Leaving `AI_FREE_MODELS_ONLY=false` keeps free models in the chain as fallbacks
behind the paid ones, which is the better setting once you have credit.

---

## 3. Outreach: the `manual` channel

This is the part people assume must cost money, and the assumption is wrong for
the wrong reason.

Cold outreach on WhatsApp and Instagram is not blocked by price. It is blocked
by policy:

- **WhatsApp Cloud API has no free tier for marketing.** Meta's rate card is
  roughly $0.025/message in the US, $0.1365 in Germany, $0.0118 in India, plus
  whatever your BSP adds. Meta also caps how many marketing messages one person
  can receive per day. The free 24-hour window only opens when the _customer_
  messages you first.
- **Instagram cannot cold-start a conversation at all.** The API addresses an
  Instagram-scoped user id that only exists once that person has messaged your
  business account. There is no supported way to open a thread from a handle, at
  any price.

So the automated path is not merely expensive — for Instagram it does not exist.

The `manual` channel is the answer, and it is a better answer than a workaround:

1. LeadForge researches, gathers evidence, picks an angle, writes the message
   and runs it through both validation passes. All of that is unchanged.
2. Instead of calling a provider, it hands you a link. `wa.me` opens WhatsApp
   with the message already typed. `mailto:` opens your mail client. For
   Instagram the body goes to your clipboard and the profile opens.
3. You read it and press send, from your own account.
4. You confirm with "I sent it". That drives the same state machine as an
   automated send: the conversation thread opens, the lead moves to `contacted`,
   analytics update, and the follow-up sequence starts.

Cost: nothing. Limit: your own time and the platform's normal human limits.

**What you give up:** no delivery receipts, and no automated reply capture — the
reply arrives in your own inbox. LeadForge records the send as your confirmation
and labels it that way rather than fabricating a provider receipt. The
`providerMessageId` is `manual:<draftId>`, which is honest about what it is.

A message sent by a real person from a real account also gets answered more
often by a small business owner than a template does. This is not purely a
downgrade.

---

## 4. Data stores

**Postgres — [Neon][neon] free plan.** 0.5 GB storage and 100 compute-hours per
project per month, no credit card, and permanent rather than a trial. Compute
suspends until the next billing month if you exceed it. That is comfortable for
tens of thousands of leads.

**Redis — run it yourself.** This is the one place where the obvious free
service is the wrong choice. Upstash's free Redis allows 500,000 commands per
_month_. BullMQ polls continuously across nine queues, so that budget is gone in
days without a single lead being processed. Per-command pricing and a polling
job queue are a bad match. Run Redis on the same machine as the worker
(`docs/44-RUNNING-WITHOUT-DOCKER.md`), where it is free and unmetered.

---

## 5. Hosting — where "free" actually runs out

Be clear-eyed about this part.

**The web app is genuinely free.** Next.js on Vercel's Hobby plan, pointed at
your API URL. Nothing else to arrange.

**The worker is the problem.** It must run continuously — the pipeline advances
through queued jobs, and follow-ups fire from a scheduled sweep. As of September
2026:

- **Render** free web services spin down after 15 minutes idle and take up to a
  minute to wake. Its free Key Value store is 25 MB and _in-memory only_, wiped
  on every restart — which would lose queued jobs. Background workers, the
  service type this needs, are not offered free.
- **Fly.io** no longer has a free allowance. New accounts get a trial of 2 VM
  hours or 7 days.
- A spun-down API is survivable (the first request is slow). A spun-down worker
  is not: no jobs run, so nothing progresses.

**So the honest answer is:** there is no fully free, always-on _cloud_ home for
the worker in 2026. Two ways to still pay nothing:

1. **Run the API, worker and Redis on a machine you already own** — your own
   computer, or any box that stays on — with Postgres on Neon and the web app on
   Vercel. This is a complete, working, £0 deployment. It is also exactly the
   setup described in `docs/44`, so you are already running it.
2. **Run everything locally.** Postgres and Redis native, all three apps local.
   Zero external dependencies except OpenRouter and Overpass.

If you want it in the cloud, the cheapest honest number is about **$7/month**
for a single always-on worker, or a **$5/month VPS** running all three services
plus Redis with Neon holding the database. That is the point where you should
stop optimising for free and just pay it.

---

## Putting it together

`.env` for the zero-cost configuration:

```bash
# Discovery — no key needed
# (set source: 'openstreetmap' on the campaign; it is the wizard default)

# AI — free models only, hard filter
AI_ENABLED=true
AI_FREE_MODELS_ONLY=true
OPENROUTER_API_KEY=sk-or-v1-...

# Data — local, or Neon for Postgres
DATABASE_URL=postgresql://leadforge:leadforge@localhost:5462/leadforge?schema=public
REDIS_URL=redis://localhost:6389

# Outreach — nothing to configure. The manual channel needs no provider.
```

Then:

```bash
pnpm services      # postgres + redis
pnpm db:migrate
pnpm build
pnpm start:api & pnpm start:worker & pnpm --filter @leadforge/web start
```

Create a campaign with source **OpenStreetMap** and channel **Send it
yourself**. Everything from discovery to a validated, evidence-grounded message
with a one-click send link runs without a bill.

[odbl]: https://www.openstreetmap.org/copyright
[neon]: https://neon.com/pricing
