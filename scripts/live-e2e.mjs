#!/usr/bin/env node
/**
 * Live end-to-end proof.
 *
 * Runs a real campaign against real providers — Google Places or OpenStreetMap
 * for discovery, real websites for enrichment, real OpenRouter models for
 * analysis, scoring narrative and message generation — and reports what
 * actually came back. Nothing here is stubbed; if a provider is down, this
 * fails, which is the point.
 *
 *   node scripts/live-e2e.mjs [openstreetmap|google_places]
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const SOURCE = process.argv[2] ?? 'openstreetmap';
const stamp = Date.now();

let cookie = '';
const log = (...args) => console.log(...args);

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until `check` returns truthy, or gives up with the last value seen. */
async function until(label, check, { attempts = 60, intervalMs = 5_000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    last = await check();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

log(`\n=== LeadForge live end-to-end (source: ${SOURCE}) ===\n`);

// 1. A real account -----------------------------------------------------
const email = `live+${stamp}@leadforge.test`;
await call('POST', '/auth/signup', {
  email,
  password: 'LiveTest!2026pass',
  name: 'Live Tester',
  organizationName: `Live ${stamp}`,
});
log(`signed up  ${email}`);

// 2. A real campaign ----------------------------------------------------
const campaign = await call('POST', '/campaigns', {
  name: `Live ${SOURCE} ${stamp}`,
  source: SOURCE,
  channel: 'manual',
  target: {
    categories: ['restaurant'],
    keywords: [],
    geo: { location: 'Manchester', country: 'GB', latitude: 53.4808, longitude: -2.2426, radiusMeters: 4_000 },
    leadLimit: 5,
  },
  filters: { websiteCondition: 'any', socialCondition: 'any', requireContact: ['phone'] },
  ai: {
    offer: 'A done-for-you Google Business Profile and simple booking website for independent restaurants.',
    objective: 'Book a 15 minute call this week.',
    tone: 'friendly',
    cta: 'Ask if they are open to a quick chat this week.',
    senderName: 'Sam',
    senderCompany: 'LeadForge Studio',
    tier: 'balanced',
  },
  autoPersonalize: true,
});
log(`campaign   ${campaign.id}`);

// 3. Run it for real ----------------------------------------------------
const run = await call('POST', `/campaigns/${campaign.id}/start`, { leadLimit: 5, refresh: false });
log(`run        ${run.id ?? run.runId ?? JSON.stringify(run).slice(0, 120)}`);

// 4. Wait for discovery + the pipeline ----------------------------------
const leads = await until('leads to be discovered and scored', async () => {
  const list = await call('GET', `/leads?campaignId=${campaign.id}&pageSize=10`);
  const scored = list.items.filter((l) => l.leadScore !== null && l.leadScore !== undefined);
  process.stdout.write(`\r  discovered ${list.total}, scored ${scored.length}   `);
  return scored.length > 0 ? list : null;
});
log(`\nleads      ${leads.total} discovered, showing top ${Math.min(3, leads.items.length)}\n`);

for (const lead of leads.items.slice(0, 3)) {
  log(`  • ${lead.canonicalName}`);
  log(`      score ${lead.leadScore ?? '-'} (${lead.temperature ?? '-'})  status ${lead.status}  verification ${lead.verificationStatus}`);
  log(`      phone ${lead.phone ?? '-'}  email ${lead.email ?? '-'}`);
  log(`      website ${lead.website ?? '-'} (${lead.websiteStatus ?? '-'})  source ${lead.source}`);
}

// 5. The intelligence report is the product's core claim ----------------
const top = leads.items.find((l) => l.leadScore !== null) ?? leads.items[0];
const detail = await call('GET', `/leads/${top.id}`);
log(`\n--- intelligence for ${detail.canonicalName} ---`);
log(`  evidence items : ${detail.evidence?.length ?? 0}`);
if (detail.intelligence) {
  log(`  summary        : ${String(detail.intelligence.summary ?? '').slice(0, 200)}`);
  log(`  pain points    : ${(detail.intelligence.painPoints ?? []).length}`);
  log(`  opportunities  : ${(detail.intelligence.opportunities ?? []).length}`);
  log(`  angle          : ${detail.intelligence.recommendedAngle ?? '-'}`);
} else {
  log('  (no intelligence report yet)');
}
if (detail.scoreBreakdown) {
  log(`  score breakdown: ${JSON.stringify(detail.scoreBreakdown).slice(0, 260)}`);
}

// 6. A real AI-written message ------------------------------------------
// `autoPersonalize` already queued one when the lead was scored, so the draft
// is read rather than requested again — asking twice would generate a second
// message and bill for it.
log('\n--- the AI-written message ---');
const withDrafts = await until('a generated draft', async () => {
  const d = await call('GET', `/leads/${top.id}`);
  return (d.drafts ?? []).length > 0 ? d : null;
}, { attempts: 24, intervalMs: 5_000 });

const draft = withDrafts.drafts[0];
log(`  channel    : ${draft.channel}   kind: ${draft.kind}`);
log(`  model      : ${draft.model ?? '-'}`);
log(`  validation : ${draft.validationStatus}`);
if ((draft.validationErrors ?? []).length > 0) {
  log(`  issues     : ${JSON.stringify(draft.validationErrors).slice(0, 300)}`);
}
log('  body       :');
for (const line of String(draft.body).split('\n')) log(`    ${line}`);

// 7. Approve, then take the free manual send path ------------------------
const approved = await call('POST', `/outreach/${draft.id}/approve`, { startSequence: true });
log(`\n  approved   : ${approved.status}`);

const link = await call('GET', `/outreach/${draft.id}/send-link`);
log(`  send link  : ${link.kind} -> ${String(link.url).slice(0, 120)}`);
log(`  instruction: ${link.instruction}`);

const sent = await call('POST', `/outreach/${draft.id}/mark-sent`, {});
log(`  marked sent: ${sent.status}`);

// 8. It must show up everywhere the product promises ---------------------
const conversations = await call('GET', '/conversations');
const analytics = await call('GET', '/analytics/overview');
const usage = await call('GET', '/ai/usage');
log(`\n--- downstream ---`);
log(`  conversations : ${conversations.total ?? conversations.items?.length ?? 0}`);
log(`  contacted     : ${analytics.funnel?.find((s) => s.stage === 'contacted')?.count ?? 0}`);
log(`  AI calls       : ${usage.totals?.calls ?? usage.calls ?? 0}, cost $${usage.totals?.costUsd ?? usage.costUsd ?? 0}`);

log('\n=== live end-to-end complete ===\n');
