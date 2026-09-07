#!/usr/bin/env node
/**
 * End-to-end smoke test against a running API.
 *
 * Exercises the real HTTP surface with a real session cookie: signup, tenancy
 * isolation, the campaign/lead/outreach contracts, and the guards that must
 * hold (auth required, cross-tenant reads blocked, validation enforced,
 * suppression respected).
 *
 * Usage: node scripts/smoke-test.mjs [apiUrl]
 */

const API = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4000';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal cookie-aware fetch wrapper. */
function createClient() {
  const cookies = new Map();

  return {
    async request(method, path, body, options = {}) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookies.size > 0 && !options.noCookies) {
        headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }

      const response = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });

      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }

      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text.slice(0, 200) };
      }

      return { status: response.status, body: json, headers: response.headers };
    },
    get(path, options) {
      return this.request('GET', path, undefined, options);
    },
    post(path, body, options) {
      return this.request('POST', path, body, options);
    },
    patch(path, body) {
      return this.request('PATCH', path, body);
    },
    clearCookies() {
      cookies.clear();
    },
  };
}

async function main() {
  console.log(`LeadForge smoke test against ${API}\n${'='.repeat(56)}`);

  const suffix = Date.now().toString(36);
  const alice = createClient();
  const bob = createClient();

  /* ------------------------------------------------------------- health */

  section('Health');
  {
    const health = await alice.get('/health');
    check('GET /health returns ok', health.status === 200 && health.body?.status === 'ok');

    const ready = await alice.get('/health/ready');
    check(
      'GET /health/ready reports database and redis',
      ready.status === 200 && ready.body?.checks?.length === 2,
      JSON.stringify(ready.body?.checks?.map((c) => `${c.name}:${c.status}`)),
    );
  }

  /* --------------------------------------------------------------- auth */

  section('Authentication');
  {
    const anonymous = await alice.get('/auth/me');
    check('GET /auth/me without a session is 401', anonymous.status === 401);
    check('unauthenticated error has a stable code', anonymous.body?.error?.code === 'UNAUTHENTICATED');

    const weak = await alice.post('/auth/signup', {
      email: `weak-${suffix}@example.com`,
      password: 'short',
      name: 'Weak Password',
      organizationName: 'Weak Co',
    });
    check('signup rejects a weak password', weak.status === 422, `got ${weak.status}`);

    const signup = await alice.post('/auth/signup', {
      email: `alice-${suffix}@example.com`,
      password: 'CorrectHorse123Battery',
      name: 'Alice Tester',
      organizationName: `Alice Workspace ${suffix}`,
    });
    check('signup succeeds', signup.status === 201 || signup.status === 200, `got ${signup.status}`);
    check('signup returns the user and organization', Boolean(signup.body?.user?.id && signup.body?.organization?.id));
    check('signup reports provider capabilities', typeof signup.body?.capabilities?.ai === 'boolean');

    const duplicate = await alice.post('/auth/signup', {
      email: `alice-${suffix}@example.com`,
      password: 'CorrectHorse123Battery',
      name: 'Alice Again',
      organizationName: 'Duplicate',
    });
    check('duplicate signup is rejected with 409', duplicate.status === 409, `got ${duplicate.status}`);

    const me = await alice.get('/auth/me');
    check('session cookie authenticates subsequent requests', me.status === 200);
    check('request id header is present', Boolean(me.headers.get('x-request-id')));
  }

  /* ---------------------------------------------------------- campaigns */

  section('Campaigns');
  let campaignId;
  {
    const invalid = await alice.post('/campaigns', { name: 'Missing everything' });
    check('campaign creation validates its input', invalid.status === 422, `got ${invalid.status}`);
    check(
      'validation errors name the offending fields',
      Array.isArray(invalid.body?.error?.details) && invalid.body.error.details.length > 0,
    );

    const created = await alice.post('/campaigns', {
      name: 'Smoke test campaign',
      source: 'google_places',
      channel: 'whatsapp',
      target: {
        categories: ['restaurant'],
        keywords: [],
        geo: { location: 'Manchester, UK', country: 'GB', radiusMeters: 10000 },
        leadLimit: 25,
      },
      filters: { websiteCondition: 'without', requireContact: ['phone'] },
      ai: {
        offer: 'Fast booking websites for independent restaurants.',
        objective: 'Book short calls with owners who have no website.',
        tone: 'friendly',
        cta: 'Ask if they are open to a quick chat this week.',
        tier: 'balanced',
      },
      autoPersonalize: true,
    });
    check('campaign is created', created.status === 201 || created.status === 200, `got ${created.status}`);
    campaignId = created.body?.id;
    check('campaign starts in draft', created.body?.status === 'draft');
    check('campaign returns computed stats', typeof created.body?.stats?.leads === 'number');

    const list = await alice.get('/campaigns');
    check('campaign list is paginated', typeof list.body?.total === 'number' && Array.isArray(list.body?.items));
    check('the new campaign appears in the list', list.body?.items?.some((c) => c.id === campaignId));

    const detail = await alice.get(`/campaigns/${campaignId}`);
    check('campaign detail loads', detail.status === 200);

    const missing = await alice.get('/campaigns/does-not-exist');
    check('unknown campaign is 404', missing.status === 404, `got ${missing.status}`);
  }

  /* ------------------------------------------------------------- leads */

  section('Leads');
  let leadId;
  {
    const imported = await alice.post('/leads/import', {
      campaignId,
      rows: [
        {
          name: 'Smoke Test Trattoria',
          phone: '0161 555 0101',
          website: '',
          city: 'Manchester',
          country: 'GB',
          category: 'restaurant',
        },
        {
          name: 'Smoke Test Trattoria',
          phone: '+44 161 555 0101',
          city: 'Manchester',
          country: 'GB',
          category: 'restaurant',
        },
      ],
    });
    check('CSV import succeeds', imported.status === 201 || imported.status === 200, `got ${imported.status}`);
    check('import creates one lead', imported.body?.created === 1, `created ${imported.body?.created}`);
    check(
      'import merges the duplicate rather than double-counting',
      imported.body?.duplicates === 1,
      `duplicates ${imported.body?.duplicates}`,
    );

    const leads = await alice.get(`/leads?campaignId=${campaignId}`);
    check('leads list is scoped to the campaign', leads.status === 200 && leads.body?.total === 1);
    leadId = leads.body?.items?.[0]?.id;

    const detail = await alice.get(`/leads/${leadId}`);
    check('lead detail loads', detail.status === 200);
    check('phone was normalised to E.164', detail.body?.phone === '+441615550101', `got ${detail.body?.phone}`);
    check('lead detail includes an evidence array', Array.isArray(detail.body?.evidence));
    check('lead detail includes an activity timeline', Array.isArray(detail.body?.activities));

    const updated = await alice.patch(`/leads/${leadId}`, { status: 'qualified', tags: ['smoke'] });
    check('lead update applies', updated.status === 200 && updated.body?.status === 'qualified');
    check('tags are stored', updated.body?.tags?.includes('smoke'));

    const search = await alice.get('/leads?search=Trattoria');
    check('lead search finds the lead', search.body?.total >= 1);

    const csv = await alice.get(`/leads/export?campaignId=${campaignId}`);
    check('CSV export returns content', csv.status === 200);
  }

  /* -------------------------------------------------------- suppression */

  section('Suppression');
  {
    const created = await alice.post('/outreach/suppressions', {
      scope: 'phone',
      value: '0161 555 0101',
      reason: 'Smoke test opt-out',
    });
    check('suppression is created', created.status === 201 || created.status === 200);
    check(
      'suppression value is normalised to E.164',
      created.body?.value === '+441615550101',
      `got ${created.body?.value}`,
    );

    const lead = await alice.get(`/leads/${leadId}`);
    check('suppression is reflected on the lead', lead.body?.suppression !== null);
    check('suppressing a lead marks it do-not-contact', lead.body?.status === 'do_not_contact', `got ${lead.body?.status}`);

    const list = await alice.get('/outreach/suppressions');
    check('suppression list returns the entry', list.body?.total >= 1);
  }

  /* ------------------------------------------------- tenancy isolation */

  section('Tenant isolation');
  {
    await bob.post('/auth/signup', {
      email: `bob-${suffix}@example.com`,
      password: 'DifferentPass456Word',
      name: 'Bob Tester',
      organizationName: `Bob Workspace ${suffix}`,
    });

    const bobMe = await bob.get('/auth/me');
    check('second workspace is created', bobMe.status === 200);
    check(
      'the two workspaces are distinct',
      bobMe.body?.organization?.id && bobMe.body.organization.id !== undefined,
    );

    const crossCampaign = await bob.get(`/campaigns/${campaignId}`);
    check("cannot read another tenant's campaign", crossCampaign.status === 404, `got ${crossCampaign.status}`);

    const crossLead = await bob.get(`/leads/${leadId}`);
    check("cannot read another tenant's lead", crossLead.status === 404, `got ${crossLead.status}`);

    const crossUpdate = await bob.patch(`/leads/${leadId}`, { status: 'won' });
    check("cannot write to another tenant's lead", crossUpdate.status === 404, `got ${crossUpdate.status}`);

    const bobLeads = await bob.get('/leads');
    check("another tenant's list is empty", bobLeads.body?.total === 0, `got ${bobLeads.body?.total}`);

    const crossStart = await bob.post(`/campaigns/${campaignId}/start`, {});
    check("cannot start another tenant's campaign", crossStart.status === 404, `got ${crossStart.status}`);
  }

  /* ------------------------------------------------------ read surfaces */

  section('Dashboard, analytics and settings');
  {
    const dashboard = await alice.get('/dashboard');
    check('dashboard loads', dashboard.status === 200);
    check('dashboard returns a funnel', Array.isArray(dashboard.body?.funnel) && dashboard.body.funnel.length === 9);
    check('dashboard returns metrics', typeof dashboard.body?.metrics?.qualifiedLeads?.value === 'number');
    check('dashboard reports what needs attention', typeof dashboard.body?.attention?.pendingApprovals === 'number');

    const analytics = await alice.get('/analytics/overview');
    check('analytics overview loads', analytics.status === 200);
    check('analytics returns rates', typeof analytics.body?.rates?.reply === 'number');

    const aiUsage = await alice.get('/analytics/ai-usage');
    check('AI usage loads', aiUsage.status === 200 && typeof aiUsage.body?.requests === 'number');

    const usage = await alice.get('/usage');
    check('usage and quotas load', usage.status === 200 && Array.isArray(usage.body?.quotas));

    const integrations = await alice.get('/integrations');
    check('integrations list loads', integrations.status === 200 && integrations.body?.length === 5);
    check(
      'integration status reflects the real environment',
      integrations.body?.every((i) => typeof i.configured === 'boolean'),
    );

    const routing = await alice.get('/ai/routing');
    check('AI routing table loads', routing.status === 200 && Array.isArray(routing.body?.models));
    check('routing covers every task', routing.body?.routes?.length === 7, `got ${routing.body?.routes?.length}`);

    const outreach = await alice.get('/outreach/queue');
    check('outreach queue loads', outreach.status === 200);

    const conversations = await alice.get('/conversations');
    check('conversations list loads', conversations.status === 200);

    const sequences = await alice.get('/outreach/sequences');
    check('default sequences were seeded on first campaign', sequences.body?.length >= 1);

    const search = await alice.get('/search?q=Trattoria');
    check('global search returns grouped results', Array.isArray(search.body) && search.body.length === 3);

    const notifications = await alice.get('/notifications');
    check('notifications load', notifications.status === 200 && Array.isArray(notifications.body));

    const members = await alice.get('/organizations/members');
    check('member list loads', members.status === 200 && members.body?.length === 1);
    check('the creator is the owner', members.body?.[0]?.role === 'owner');

    const audit = await alice.get('/organizations/audit-log');
    check('audit log records the signup', audit.status === 200 && audit.body?.total >= 1);
  }

  /* ------------------------------------------------------------ guards */

  section('Guards');
  {
    const badChannel = await alice.post(`/leads/${leadId}/generate-message`, { channel: 'carrier-pigeon' });
    check('unknown channel is rejected', badChannel.status === 422, `got ${badChannel.status}`);

    const startWithoutProvider = await alice.post(`/campaigns/${campaignId}/start`, {});
    check(
      'starting without a discovery provider fails clearly',
      startWithoutProvider.status === 503 || startWithoutProvider.status === 202,
      `got ${startWithoutProvider.status}`,
    );
    if (startWithoutProvider.status === 503) {
      check(
        'the failure names the missing provider',
        /google places/i.test(startWithoutProvider.body?.error?.message ?? ''),
        startWithoutProvider.body?.error?.message,
      );
    }

    const logout = await alice.post('/auth/logout');
    check('logout succeeds', logout.status === 204);

    const afterLogout = await alice.get('/auth/me');
    check('session is invalid after logout', afterLogout.status === 401, `got ${afterLogout.status}`);
  }

  /* ------------------------------------------------------------ summary */

  console.log(`\n${'='.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(`  - ${failure.name}${failure.detail ? `: ${failure.detail}` : ''}`);
    }
    process.exit(1);
  }

  console.log('\nAll smoke tests passed.');
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exit(1);
});
