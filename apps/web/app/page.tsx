import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowRight, Brain, Check, Minus, Search, Send, ShieldCheck } from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { PricingGrid } from '@/components/marketing/pricing-grid';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: { absolute: 'LeadForge AI — local leads with a reason to get in touch' },
  description:
    'LeadForge finds local businesses, checks them, explains why each one is worth contacting with evidence you can open, and drafts the message. Nothing sends without your approval.',
  // The root layout keeps the private workspace out of search; this page is public.
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

const STEPS = [
  {
    icon: Search,
    title: 'Discover',
    body: 'Pick a category and an area. LeadForge pulls matching businesses from OpenStreetMap or Google Places and merges duplicates instead of counting them twice.',
  },
  {
    icon: ShieldCheck,
    title: 'Verify',
    body: 'Seven checks — phone format, website reachability, domain match, geography and more — run in code. A model never decides whether a business is real.',
  },
  {
    icon: Brain,
    title: 'Understand',
    body: 'Each website is read and scored across six dimensions. Every pain point links to the stored observation it came from; a claim with no evidence is dropped.',
  },
  {
    icon: Send,
    title: 'Write and send',
    body: 'You get a draft grounded in that business’s facts, checked twice for invented claims. You approve it, then send by email, WhatsApp, or a one-click link from your own account.',
  },
];

const COMPARISON = [
  ['What you get', 'A list of contacts', 'A ranked shortlist with a reason for each'],
  ['“Why this lead?”', 'Not answered', 'Answered, with every claim linked to evidence'],
  ['Missing data', 'Guessed or left blank', 'Marked Unknown — never invented'],
  ['Scores', 'Opaque', 'Six dimensions computed in code, explained in words'],
  ['Messages', 'Mail-merge templates', 'Written from that business’s facts, validated twice'],
  ['Sending', 'Fires automatically', 'Nothing leaves without your approval'],
] as const;

const FAQ = [
  {
    q: 'Who is LeadForge for?',
    a: 'Freelancers and small agencies that sell services to local businesses — web design, SEO, booking systems, marketing — and would rather send twenty well-researched messages than two thousand generic ones.',
  },
  {
    q: 'Where does the business data come from?',
    a: 'OpenStreetMap, which needs no API key, or Google Places if you connect your own key (it adds ratings and review counts). You can also import a CSV you already have. Website details come from reading each business’s public site.',
  },
  {
    q: 'Can it message people on WhatsApp and Instagram automatically?',
    a: 'Not cold, and no tool legitimately can. Instagram’s API cannot start a conversation with someone who has not messaged you first, and WhatsApp only allows approved templates outside an open conversation. LeadForge writes the message and hands you a one-click link to send it from your own account, then tracks the conversation from there.',
  },
  {
    q: 'What happens when I reach a plan limit?',
    a: 'The action that would exceed it is refused with a message saying which limit was reached. Nothing is charged beyond your plan and nothing you already have is removed. Limits reset at the start of each calendar month.',
  },
  {
    q: 'Does the AI make things up?',
    a: 'It is built not to be able to. The model only sees evidence LeadForge collected, any claim it makes without citing that evidence is discarded, and scores are calculated in code rather than by the model. Where something is not known, the screen says Unknown.',
  },
  {
    q: 'Am I responsible for who I contact?',
    a: 'Yes. LeadForge keeps a do-not-contact list and blocks messages to anyone on it, but the rules on unsolicited messages differ by country and channel, and following them is your responsibility.',
  },
];

/**
 * Public home page. A signed-in visitor has no use for the pitch, so they go
 * straight to their workspace.
 */
export default async function HomePage() {
  const cookieStore = await cookies();
  if (cookieStore.has('leadforge_session')) redirect('/dashboard');

  return (
    <SiteShell>
      {/* ---------------------------------------------------------------- hero */}
      <section className="ai-surface border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div>
            <p className="eyebrow">Sales research for local-business outreach</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Stop buying lists. Start with a reason to get in touch.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground text-pretty">
              LeadForge finds local businesses, checks they are real, works out what each one is
              missing, and drafts the message you would actually send — with the evidence behind
              every claim one click away.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" className="group h-11" asChild>
                <Link href="/signup">
                  Start free
                  <ArrowRight className="icon-nudge" aria-hidden="true" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="h-11" asChild>
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Free plan includes 100 leads and 50 messages a month. No card needed.
            </p>
          </div>

          <ExampleLeadCard />
        </div>
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how-it-works" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">
            From a postcode to a conversation
          </h2>
          <p className="mt-2 max-w-2xl mk-body text-muted-foreground text-pretty">
            The research a careful salesperson would do by hand, done for every lead and shown to
            you rather than hidden.
          </p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="panel p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md border border-border bg-raised text-primary">
                    <step.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="tabular text-xs font-medium text-muted-foreground">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-1 mk-body text-muted-foreground text-pretty">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------------ why */}
      <section id="why" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">A list is not a pipeline</h2>
          <p className="mt-2 max-w-2xl mk-body text-muted-foreground text-pretty">
            Most lead tools hand over thousands of rows and leave the real work — opening each
            website, deciding who is worth a message, writing something that is not a template — to
            you.
          </p>

          {/* Scrolls sideways on a narrow screen; focusable so a keyboard can too. */}
          <div
            className="panel mt-8 overflow-x-auto"
            role="region"
            aria-label="LeadForge compared with a typical lead tool"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="w-[24%] px-4 py-3 font-medium text-muted-foreground">
                    <span className="sr-only">Aspect</span>
                  </th>
                  <th scope="col" className="w-[30%] px-4 py-3 font-medium text-muted-foreground">
                    Typical lead tool
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    LeadForge
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {COMPARISON.map(([aspect, typical, leadforge]) => (
                  <tr key={aspect}>
                    <th scope="row" className="px-4 py-3 font-medium">
                      {aspect}
                    </th>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="flex items-start gap-2">
                        <Minus className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden="true" />
                        {typical}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                        {leadforge}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Principle
              title="Evidence before claims"
              body="Every observation is stored with its source, a timestamp and a confidence. What you read is labelled Observed, Inferred or Unknown, so you always know how far to trust it."
            />
            <Principle
              title="Scores you can argue with"
              body="Fit, opportunity, contactability, maturity, confidence and urgency are computed from stored facts. The same business scores the same every time, and each number comes with its reason."
            />
            <Principle
              title="Honest about the channels"
              body="Where a platform will not allow automated cold messages, LeadForge says so and gives you a one-click link to send from your own account instead of a button that quietly fails."
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- pricing */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Simple monthly plans</h2>
          <p className="mt-2 max-w-2xl mk-body text-muted-foreground text-pretty">
            Start on Free and move up when the limits get in your way. Every plan runs the same
            research pipeline.
          </p>
          <div className="mt-8">
            <PricingGrid />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ faq */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Questions people ask first</h2>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
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
                <p className="mt-2 mk-body text-muted-foreground text-pretty">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <section className="surface-gradient">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">
            Run your first campaign in a few minutes
          </h2>
          <p className="mt-2 mk-body text-muted-foreground text-pretty">
            Create a workspace, choose a category and an area, and read the first researched leads
            while the rest are still being checked.
          </p>
          <Button variant="primary" size="lg" className="group mt-6" asChild>
            <Link href="/signup">
              Create a free workspace
              <ArrowRight className="icon-nudge" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </SiteShell>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-5">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 mk-body text-muted-foreground text-pretty">{body}</p>
    </div>
  );
}

/**
 * An illustration of a lead screen, with invented details and labelled as an
 * example. It shows the shape of the output — a score, reasons, and evidence
 * labels — without presenting a made-up business as a real result.
 */
function ExampleLeadCard() {
  return (
    <figure className="panel-raised p-5 shadow-overlay">
      <figcaption className="eyebrow">Example lead — illustrative data</figcaption>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold tracking-tight">Harbour Street Dental</p>
          <p className="text-sm text-muted-foreground">Dentist · Bristol · Verified</p>
        </div>
        <div className="text-right">
          <p className="tabular text-3xl font-semibold tracking-tight text-hot">82</p>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-hot">Hot</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
        <Evidence
          label="Observed"
          tone="success"
          text="No online booking link anywhere on the site."
          source="Website, checked today"
        />
        <Evidence
          label="Observed"
          tone="success"
          text="Phone number is valid and matches the listed area."
          source="Verification"
        />
        <Evidence
          label="Inferred"
          tone="warning"
          text="Patients probably have to phone during opening hours to book."
          source="From the two observations above"
        />
        <Evidence label="Unknown" tone="muted" text="Who makes purchasing decisions." source="" />
      </ul>

      <div className="mt-4 rounded-md border border-primary/25 bg-primary/[0.06] p-3">
        <p className="eyebrow text-primary">Draft — waiting for your approval</p>
        <p className="mt-1.5 text-sm text-pretty">
          Hi — I was looking at your site and could not find a way to book online. I set up booking
          pages for independent practices. Open to a quick chat this week?
        </p>
      </div>
    </figure>
  );
}

function Evidence({
  label,
  tone,
  text,
  source,
}: {
  label: string;
  tone: 'success' | 'warning' | 'muted';
  text: string;
  source: string;
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-success/15 text-success'
      : tone === 'warning'
        ? 'bg-warning/15 text-warning'
        : 'bg-muted text-muted-foreground';
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 w-[4.5rem] shrink-0 rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold ${toneClass}`}
      >
        {label}
      </span>
      <span className="text-sm">
        {text}
        {source ? <span className="block text-xs text-muted-foreground">{source}</span> : null}
      </span>
    </li>
  );
}
