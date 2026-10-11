import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Brain,
  FileSearch,
  Hand,
  MessageSquareText,
  Scale,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { SiteShell } from '@/components/marketing/site-shell';
import { PricingGrid } from '@/components/marketing/pricing-grid';
import { PipelineDemo } from '@/components/marketing/pipeline-demo';
import {
  CategoryMarquee,
  ComparisonSwitch,
  CountUp,
  ScoreExplorer,
  SpotlightSection,
  type ComparisonRow,
} from '@/components/marketing/interactive';
import { Reveal } from '@/components/ui/motion';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: { absolute: 'LeadForge AI — local leads with a reason to get in touch' },
  description:
    'LeadForge finds local businesses, checks them, explains why each one is worth contacting with evidence you can open, and drafts the message. Nothing sends without your approval.',
  // The root layout keeps the private workspace out of search; this page is public.
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

/** Facts about how the product works, not claims about results. */
const FIGURES = [
  { value: 7, label: 'checks before a lead is called verified', suffix: '' },
  { value: 6, label: 'score dimensions, each with its reason', suffix: '' },
  { value: 2, label: 'gates every draft passes before you see it', suffix: '' },
  { value: 0, label: 'messages sent without your approval', suffix: '' },
];

const CATEGORIES = [
  'Dentists',
  'Restaurants',
  'Hair salons',
  'Gyms',
  'Estate agents',
  'Physiotherapists',
  'Cafes',
  'Car repair',
  'Vets',
  'Opticians',
  'Florists',
  'Accountants',
  'Hotels',
  'Bakeries',
  'Beauty clinics',
  'Plumbers',
];

const STEPS = [
  {
    icon: Search,
    title: 'Discover',
    body: 'Pick a category and an area. Matching businesses come from OpenStreetMap or Google Places, and duplicates are merged instead of counted twice.',
  },
  {
    icon: ShieldCheck,
    title: 'Verify',
    body: 'Seven checks — phone format, website reachability, domain match, geography and more — run in code. A model never decides whether a business is real.',
  },
  {
    icon: Brain,
    title: 'Understand',
    body: 'Each website is read and scored across six dimensions. Every pain point links to the observation it came from; a claim with no evidence is dropped.',
  },
  {
    icon: Send,
    title: 'Write and send',
    body: 'A draft grounded in that business’s facts, checked twice for invented claims. You approve it, then send by email, WhatsApp, or a one-click link.',
  },
];

const COMPARISON: ComparisonRow[] = [
  {
    aspect: 'What you get',
    typical: 'A list of contacts.',
    leadforge: 'A ranked shortlist with a reason for each lead.',
  },
  {
    aspect: '“Why this lead?”',
    typical: 'Not answered.',
    leadforge: 'Answered, with every claim linked to evidence.',
  },
  {
    aspect: 'Missing data',
    typical: 'Guessed, or left blank.',
    leadforge: 'Marked Unknown. Never invented.',
  },
  {
    aspect: 'Scores',
    typical: 'A number with no explanation.',
    leadforge: 'Six dimensions computed in code, explained in words.',
  },
  {
    aspect: 'Messages',
    typical: 'Mail-merge templates.',
    leadforge: 'Written from that business’s facts and validated twice.',
  },
  {
    aspect: 'Sending',
    typical: 'Fires automatically.',
    leadforge: 'Nothing leaves without your approval.',
  },
];

const PRINCIPLES = [
  {
    icon: FileSearch,
    title: 'Evidence before claims',
    body: 'Every observation is stored with its source, a timestamp and a confidence. What you read is labelled Observed, Inferred or Unknown.',
  },
  {
    icon: Scale,
    title: 'Scores you can argue with',
    body: 'The same business scores the same every time, because the numbers come from stored facts, not from a model’s mood.',
  },
  {
    icon: MessageSquareText,
    title: 'Messages that survive a hostile read',
    body: 'No guaranteed outcomes, no invented statistics, no pretending to be a customer. A rule engine checks first; a second model checks after.',
  },
  {
    icon: Hand,
    title: 'You are the one who sends',
    body: 'Drafts wait in a queue for your approval. Edit, reject or send — the decision to contact someone is always yours.',
  },
  {
    icon: BadgeCheck,
    title: 'Honest about the channels',
    body: 'Where a platform will not allow automated cold messages, you get a one-click link to send from your own account, not a button that quietly fails.',
  },
  {
    icon: ShieldCheck,
    title: 'Opt-outs are final',
    body: 'Every email carries an unsubscribe link, and anyone on your do-not-contact list is blocked at approval and again at send.',
  },
];

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
      <SpotlightSection className="overflow-hidden border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-14 pt-14 sm:px-6 lg:grid-cols-[1fr_1.02fr] lg:items-center lg:pb-20 lg:pt-20">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Sales research for local-business outreach
            </p>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Stop buying lists. Start with{' '}
              <span className="mk-gradient-text">a reason to get in touch.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground text-pretty">
              LeadForge finds local businesses, checks they are real, works out what each one is
              missing, and drafts the message you would actually send — with the evidence behind
              every claim one click away.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                className="group h-11 shadow-glow transition-shadow duration-300 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.5),0_0_36px_-4px_hsl(var(--primary)/0.6)]"
                asChild
              >
                <Link href="/signup">
                  Start free
                  <ArrowRight className="icon-nudge" aria-hidden="true" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="h-11" asChild>
                <Link href="#how-it-works">See how it works</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Free plan includes 100 leads and 50 messages a month. No card needed.
            </p>
          </div>

          <div className="animate-fade-up [animation-delay:120ms] [animation-fill-mode:both]">
            <PipelineDemo />
          </div>
        </div>

        {/* Figures: how the product behaves, counted up as they come into view. */}
        <div className="border-t border-border bg-background/60 backdrop-blur-sm">
          <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
            {FIGURES.map((figure) => (
              <div
                key={figure.label}
                className="group px-2 py-6 transition-colors duration-300 hover:bg-primary/[0.04] sm:px-4"
              >
                <dd className="tabular text-4xl font-semibold tracking-tight transition-colors duration-300 group-hover:text-primary">
                  <CountUp value={figure.value} />
                </dd>
                <dt className="mt-1 text-sm text-muted-foreground text-pretty">{figure.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </SpotlightSection>

      {/* ----------------------------------------------------------- categories */}
      <section className="border-b border-border py-8">
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Run a campaign for any kind of local business
        </p>
        <CategoryMarquee items={CATEGORIES} />
      </section>

      {/* -------------------------------------------------------- how it works */}
      <section id="how-it-works" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
              From a postcode to a conversation
            </h2>
            <p className="mk-body mt-2 max-w-2xl text-muted-foreground text-pretty">
              The research a careful salesperson would do by hand, done for every lead and shown to
              you rather than hidden.
            </p>
          </Reveal>

          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Reveal as="li" key={step.title} delay={index * 90}>
                <div className="mk-card">
                  <div className="flex items-center justify-between">
                    <span className="mk-card-icon">
                      <step.icon className="size-5" aria-hidden="true" />
                    </span>
                    <span
                      className="tabular text-4xl font-semibold tracking-tight text-border-strong"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="mk-body mt-1 text-muted-foreground text-pretty">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------------------------------------------- why */}
      <section id="why" className="scroll-mt-16 border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="eyebrow">Why LeadForge</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
              A list is not a pipeline
            </h2>
            <p className="mk-body mt-2 max-w-2xl text-muted-foreground text-pretty">
              Most lead tools hand over thousands of rows and leave the real work to you. Flip the
              switch and see the same six questions answered both ways.
            </p>
          </Reveal>

          <Reveal className="mt-8" delay={80}>
            <ComparisonSwitch rows={COMPARISON} />
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------------- score */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="eyebrow">Explainable scoring</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
              Ask any number why
            </h2>
            <p className="mk-body mt-2 max-w-2xl text-muted-foreground text-pretty">
              A lead’s score is six separate judgements. Point at one to see what it is based on.
            </p>
          </Reveal>

          <Reveal className="mt-8" delay={80}>
            <ScoreExplorer />
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------- principles */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="eyebrow">Built to be trusted</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
              What it will not do matters as much as what it does
            </h2>
          </Reveal>

          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map((principle, index) => (
              <Reveal as="li" key={principle.title} delay={(index % 3) * 90}>
                <div className="mk-card">
                  <span className="mk-card-icon">
                    <principle.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">{principle.title}</h3>
                  <p className="mk-body mt-1 text-muted-foreground text-pretty">{principle.body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* -------------------------------------------------------------- pricing */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <p className="eyebrow">Pricing</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Simple monthly plans</h2>
            <p className="mk-body mt-2 max-w-2xl text-muted-foreground text-pretty">
              Start on Free and move up when the limits get in your way. Every plan runs the same
              research pipeline.
            </p>
          </Reveal>
          <Reveal className="mt-8" delay={80}>
            <PricingGrid />
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------------ faq */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight">Questions people ask first</h2>
          </Reveal>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {FAQ.map((item) => (
              <details key={item.q} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-1 py-4 text-md font-medium transition-colors duration-200 hover:text-primary [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-lg leading-none text-muted-foreground transition-[transform,border-color,color] duration-300 group-open:rotate-45 group-open:border-primary/40 group-open:text-primary"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mk-body animate-fade-in px-1 pb-4 text-muted-foreground text-pretty">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <SpotlightSection className="overflow-hidden">
        <Reveal className="mx-auto w-full max-w-3xl px-4 py-20 text-center sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Run your first campaign in <span className="mk-gradient-text">a few minutes</span>
          </h2>
          <p className="mk-body mt-3 text-muted-foreground text-pretty">
            Create a workspace, choose a category and an area, and read the first researched leads
            while the rest are still being checked.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" size="lg" className="group h-11 shadow-glow" asChild>
              <Link href="/signup">
                Create a free workspace
                <ArrowRight className="icon-nudge" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" className="h-11" asChild>
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>
        </Reveal>
      </SpotlightSection>
    </SiteShell>
  );
}
