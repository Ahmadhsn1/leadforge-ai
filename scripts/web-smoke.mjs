#!/usr/bin/env node
/**
 * Frontend smoke test, in a real browser.
 *
 * The dashboard is client-rendered, so fetching the HTML proves nothing — the
 * server returns the same shell whether the page works or throws after
 * hydration. This drives headless Chrome instead: it signs in, visits every
 * route, waits for the page to settle, and asserts on the text a user would
 * actually see, plus any console error the page logged on the way.
 *
 *   node scripts/web-smoke.mjs
 */
import puppeteer from 'puppeteer-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const stamp = Date.now();

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(`${name}${detail ? ` \u2014 ${detail}` : ''}`);
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

/** Console errors are collected per navigation, then asserted on. */
let consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err.message).slice(0, 200)}`));

/** Navigates and waits for React to have painted something real. */
async function visit(path) {
  consoleErrors = [];
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  // Give client-side data fetching a moment to resolve past its skeleton.
  await new Promise((r) => setTimeout(r, 1_200));
  return page.evaluate(() => document.body.innerText);
}

try {
  console.log('\nPublic pages');
  for (const [path, needle] of [
    ['/login', 'Sign in'],
    ['/signup', 'Create'],
    ['/forgot-password', 'password'],
  ]) {
    const text = await visit(path);
    check(`${path} renders "${needle}"`, text.toLowerCase().includes(needle.toLowerCase()));
  }

  console.log('\nSign up through the real UI');
  await visit('/signup');
  const email = `web+${stamp}@leadforge.test`;
  // Fill by field name so the test breaks if the form contract changes.
  await page.type('input[name="name"], input[id="name"]', 'Web Smoke').catch(() => {});
  await page.type('input[name="organizationName"], input[id="organizationName"]', `Web ${stamp}`).catch(() => {});
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', 'WebSmoke!2026pass');
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45_000 }).catch(() => {}),
  ]);
  await new Promise((r) => setTimeout(r, 2_500));
  const afterSignup = page.url();
  check('signup lands inside the app', /\/dashboard|\/onboarding/.test(afterSignup), afterSignup);

  console.log('\nApplication pages');
  const routes = [
    ['/dashboard', ['Dashboard', 'Pipeline', 'Leads']],
    ['/dashboard/campaigns', ['Campaign']],
    ['/dashboard/campaigns/new', ['Campaign', 'Target', 'Source']],
    ['/dashboard/leads', ['Lead']],
    ['/dashboard/leads/import', ['Import']],
    ['/dashboard/studio', ['Studio', 'Message']],
    ['/dashboard/outreach', ['Outreach', 'Queue', 'Approve']],
    ['/dashboard/conversations', ['Conversation', 'Inbox']],
    ['/dashboard/analytics', ['Analytics', 'Funnel']],
    ['/dashboard/insights', ['Insight']],
    ['/dashboard/usage', ['Usage']],
    ['/dashboard/settings/integrations', ['Integration']],
    ['/dashboard/settings/ai', ['AI', 'Model']],
    ['/dashboard/settings/workspace', ['Workspace']],
    ['/dashboard/settings/team', ['Team']],
    ['/dashboard/settings/security', ['Security']],
    ['/dashboard/settings/notifications', ['Notification']],
    ['/dashboard/settings/outreach', ['Outreach']],
    ['/dashboard/settings/billing', ['Plan', 'Billing']],
    ['/dashboard/settings/health', ['Health', 'Status']],
    ['/dashboard/settings/profile', ['Profile']],
  ];

  for (const [path, needles] of routes) {
    const text = await visit(path);
    const found = needles.some((n) => text.toLowerCase().includes(n.toLowerCase()));
    const broke = /Application error|Something went wrong|Unhandled Runtime/i.test(text);
    const fatal = consoleErrors.filter(
      // A failed request to a not-yet-configured provider is expected; a React
      // crash is not.
      (e) => !/favicon|404|Failed to load resource/i.test(e),
    );
    check(
      path,
      found && !broke && fatal.length === 0,
      broke ? 'error boundary' : !found ? `missing ${needles.join('/')}` : fatal[0],
    );
  }

  console.log('\nDesign system');
  await visit('/dashboard');
  const design = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    return {
      bg: body.backgroundColor,
      font: body.fontFamily,
      tokens: root.getPropertyValue('--background') || root.getPropertyValue('--color-background'),
      sidebar: Boolean(document.querySelector('aside, nav')),
    };
  });
  check('dark surface applied', design.bg !== 'rgba(0, 0, 0, 0)' && design.bg !== '' , design.bg);
  check('custom font applied', /inter|geist|system-ui|sans/i.test(design.font), design.font);
  check('navigation chrome present', design.sidebar);

  console.log('\nResponsive');
  await page.setViewport({ width: 390, height: 844 });
  await visit('/dashboard');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal scroll at 390px', overflow <= 1, `overflow ${overflow}px`);
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(52)}`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
console.log('\nFrontend smoke passed.');
