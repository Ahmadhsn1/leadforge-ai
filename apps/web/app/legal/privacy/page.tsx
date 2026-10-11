import type { Metadata } from 'next';
import { LegalPage, OPERATOR, type LegalSection } from '@/components/marketing/legal';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What LeadForge collects, why, and the choices you have.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/legal/privacy' },
};

const SECTIONS: LegalSection[] = [
  {
    heading: 'Information about you',
    paragraphs: [
      'When you create an account we store your name, email address and a one-way hash of your password. When you sign in we record the time, your IP address and your browser’s user-agent so you can see and revoke your sessions and so we can investigate misuse.',
      'We keep an audit log of significant actions in a workspace — for example signing in, inviting a member, or approving a message — with the account that performed them.',
    ],
  },
  {
    heading: 'Information about the businesses you research',
    paragraphs: [
      'LeadForge collects publicly available information about businesses: name, category, address, phone number, website, public social profiles and, where the source provides them, ratings. It reads each business’s public website to record observations such as whether it offers online booking.',
      'This is mostly information about organisations, but it can include personal data — a sole trader’s name or a published contact address, for instance. You decide which businesses are researched and contacted, so for that data you are the controller and we process it on your instructions.',
      'If someone you have contacted asks not to be contacted again, add them to the do-not-contact list. If they ask what is held about them or ask for it to be deleted, you can remove the lead or ask us to.',
    ],
  },
  {
    heading: 'How the information is used',
    paragraphs: [
      'To provide the service: running campaigns, analysing and scoring leads, drafting and sending the messages you approve, showing conversations and analytics, enforcing plan limits, and keeping the service secure.',
      'We do not sell personal data and do not use the contents of your workspace to advertise to you.',
    ],
  },
  {
    heading: 'Who else processes it',
    paragraphs: [
      'Evidence about a business, and the text of drafts and replies, is sent to AI model providers through OpenRouter so they can produce analysis and messages. Business searches are sent to OpenStreetMap’s Overpass service or, if you have connected it, Google Places. Messages you approve are sent through the channel you chose — your email server, or Meta for WhatsApp and Instagram.',
      'Payment details, if you subscribe to a paid plan, are handled by our payment provider; we receive confirmation of the subscription but not your card number. Our hosting providers store the data on our behalf.',
    ],
  },
  {
    heading: 'Cookies',
    paragraphs: [
      'LeadForge sets one cookie, which keeps you signed in. It is essential to the service, cannot be read by scripts in the page, and is not used for tracking or advertising.',
    ],
  },
  {
    heading: 'How long it is kept',
    paragraphs: [
      'Workspace data is kept for as long as the workspace exists. When a workspace is deleted, its leads, messages, evidence and logs are deleted with it. Sessions expire automatically.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      'Depending on where you live, you may have the right to see the personal data held about you, to have it corrected or deleted, to object to or restrict its use, and to receive a copy of it. You can also complain to your local data-protection authority. To use any of these rights, contact us using the details below.',
    ],
  },
  {
    heading: 'Security',
    paragraphs: [
      'Passwords are hashed with Argon2id. Session tokens are stored only as hashes. Every request is checked against the workspace of the signed-in session, so one workspace cannot read another’s data. No system is perfectly secure; if we learn of a breach affecting your data we will tell you.',
    ],
  },
  {
    heading: 'Changes to this policy',
    paragraphs: [
      'If this policy changes in a way that affects how your data is used, we will tell you in the product or by email before the change takes effect.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="2026-10-11"
      intro={`This policy explains what ${OPERATOR.name} (“we”) collects when you use LeadForge, why, and what you can do about it.`}
      sections={SECTIONS}
    />
  );
}
