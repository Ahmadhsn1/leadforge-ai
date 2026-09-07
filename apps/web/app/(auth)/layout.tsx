import { Suspense } from 'react';
import Link from 'next/link';
import { Brain, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { Wordmark } from '@/components/layout/logo';

/**
 * Split auth shell: the form on the left stays the focus, while the right
 * panel states what the product actually does — no stock marketing filler.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link
          href="/"
          className="inline-flex w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wordmark />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          {/* Auth pages read query params (?next=, ?token=), so they render
              on demand behind a boundary rather than being prerendered. */}
          <div className="w-full max-w-sm">
            <Suspense fallback={<AuthFormFallback />}>{children}</Suspense>
          </div>
        </div>
        <p className="text-2xs text-muted-foreground">
          By continuing you agree that outreach you send through LeadForge complies with the
          messaging rules of each connected platform and the contact laws of your market.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-border ai-surface lg:flex lg:flex-col lg:justify-center lg:px-12">
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-balance">
            Find the right businesses. Understand them. Start the right conversation.
          </h2>
          <p className="mt-3 text-md text-muted-foreground text-pretty">
            LeadForge runs the research a good salesperson would do — then shows you the evidence
            behind every recommendation.
          </p>

          <ul className="mt-8 space-y-5">
            <Pillar
              icon={<Target />}
              title="Discovery that filters, not floods"
              body="Search by area, category and quality bar. Duplicates are merged, not counted twice."
            />
            <Pillar
              icon={<ShieldCheck />}
              title="Verified before it reaches you"
              body="Phone format, website reachability, domain match and geography are checked deterministically — never decided by a model."
            />
            <Pillar
              icon={<Brain />}
              title="Evidence before claims"
              body="Every pain point links to a stored observation with a source, timestamp and confidence. Inferences are labelled as inferences."
            />
            <Pillar
              icon={<Sparkles />}
              title="Messages you would actually send"
              body="Channel-native drafts grounded in the facts, validated against them, and always reviewed by you before sending."
            />
          </ul>
        </div>
      </aside>
    </div>
  );
}

function AuthFormFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="skeleton h-7 w-40" />
      <div className="skeleton h-4 w-64" />
      <div className="skeleton h-9 w-full" />
      <div className="skeleton h-9 w-full" />
      <div className="skeleton h-10 w-full" />
    </div>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-primary [&_svg]:size-4"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{body}</p>
      </div>
    </li>
  );
}
