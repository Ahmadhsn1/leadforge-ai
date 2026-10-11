import { SiteShell } from './site-shell';

/**
 * Who operates this deployment. Set per deployment so the legal pages name a
 * real party and a working contact address rather than a placeholder.
 */
export const OPERATOR = {
  name: process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() || 'the operator of this LeadForge service',
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null,
};

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  /** ISO date the text last changed. */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  return (
    <SiteShell>
      <article className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated{' '}
          <time dateTime={updated}>
            {new Date(`${updated}T00:00:00Z`).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </time>
        </p>
        <p className="mt-6 text-md text-pretty">{intro}</p>

        {sections.map((section, index) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-xl font-semibold tracking-tight">
              {index + 1}. {section.heading}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 mk-body text-muted-foreground text-pretty">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-8">
          <h2 className="text-xl font-semibold tracking-tight">{sections.length + 1}. Contact</h2>
          <p className="mt-2 mk-body text-muted-foreground text-pretty">
            {OPERATOR.email ? (
              <>
                Questions about this page can be sent to{' '}
                <a href={`mailto:${OPERATOR.email}`} className="text-primary hover:underline">
                  {OPERATOR.email}
                </a>
                .
              </>
            ) : (
              'Questions about this page can be raised with the person or company that gave you access to this service.'
            )}
          </p>
        </section>
      </article>
    </SiteShell>
  );
}
