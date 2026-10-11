import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/marketing/site-shell';
import { PricingGrid } from '@/components/marketing/pricing-grid';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'LeadForge plans: a free tier with 100 leads a month, and paid plans for freelancers, small teams and agencies.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/pricing' },
};

const NOTES = [
  {
    title: 'What counts as a lead',
    body: 'A new business added to your workspace, whether discovered or imported. Duplicates that merge into a lead you already have are not counted.',
  },
  {
    title: 'What counts as an AI request',
    body: 'One call to a model: analysing a business, explaining a score, writing a draft, checking it, or suggesting a reply. A fully researched lead with one message typically uses three or four.',
  },
  {
    title: 'What counts as a message',
    body: 'A message that was actually sent, including ones you send yourself through a one-click link and confirm. Drafts you never send are free.',
  },
  {
    title: 'When limits reset',
    body: 'On the first day of each calendar month (UTC). Reaching a limit stops that one action and tells you why; it never deletes anything.',
  },
];

const BILLING_FAQ = [
  {
    q: 'Can I change plan later?',
    a: 'Yes, at any time from Settings → Billing. Moving between paid plans charges or credits the difference for the rest of the current period straight away, and the new limits apply immediately.',
  },
  {
    q: 'How do I cancel?',
    a: 'From the same screen, through the payment provider’s portal. The plan stays active until the end of the period you have paid for, then the workspace returns to Free. Nothing is deleted.',
  },
  {
    q: 'What happens to my data if I downgrade?',
    a: 'It stays. Leads, messages and conversations are kept; the lower limits only apply to new activity from that point on.',
  },
  {
    q: 'Who takes the payment?',
    a: 'Paddle, acting as merchant of record. Card details are entered in Paddle’s checkout and never reach LeadForge, and Paddle issues the invoices and handles any sales tax or VAT.',
  },
  {
    q: 'Is the price per person?',
    a: 'No. A plan covers one workspace, with the number of team members shown on its card.',
  },
];

export default function PricingPage() {
  return (
    <SiteShell>
      <section className="ai-surface border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">
            Pay for the research you use
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground text-pretty">
            Every plan runs the same pipeline — discovery, verification, analysis, scoring and
            drafting. Plans differ in how much you can run each month and how many people can work
            in the workspace.
          </p>
          <div className="mt-10">
            <h2 className="sr-only">Plans</h2>
            <PricingGrid />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Prices are in US dollars per workspace, billed monthly. Taxes may apply depending on
            where you are.
          </p>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">How the limits work</h2>
          <dl className="mt-6 grid gap-4 md:grid-cols-2">
            {NOTES.map((note) => (
              <div key={note.title} className="panel p-5">
                <dt className="text-lg font-semibold tracking-tight">{note.title}</dt>
                <dd className="mt-1 mk-body text-muted-foreground text-pretty">{note.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Billing questions</h2>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {BILLING_FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-md font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    className="text-xl leading-none text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mk-body mt-2 text-muted-foreground text-pretty">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="surface-gradient">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">
            Try it on real leads before you pay anything
          </h2>
          <p className="mt-2 mk-body text-muted-foreground text-pretty">
            The free plan is not a trial and does not expire.
          </p>
          <Button variant="primary" size="lg" className="mt-6" asChild>
            <Link href="/signup">Create a free workspace</Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}
