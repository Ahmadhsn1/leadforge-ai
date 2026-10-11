import type { Metadata } from 'next';
import { LegalPage, OPERATOR, type LegalSection } from '@/components/marketing/legal';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms that apply when you use LeadForge.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/legal/terms' },
};

const SECTIONS: LegalSection[] = [
  {
    heading: 'Your account',
    paragraphs: [
      'You need an account to use LeadForge. Keep your password private and tell us if you think someone else has used your account. You are responsible for what is done through your workspace, including by people you invite to it.',
      'You must be old enough to enter a contract where you live and, if you sign up for a company, be allowed to do so on its behalf.',
    ],
  },
  {
    heading: 'What the service does',
    paragraphs: [
      'LeadForge finds publicly listed businesses, reads their public websites, records what it observes, scores them, and drafts outreach messages for you to review. Analysis and drafts are produced with the help of AI models and can be wrong. Read a message before you approve it; you decide what is sent.',
      'Features that depend on third parties — data sources, AI providers, WhatsApp, Instagram and email — can change or stop working for reasons outside our control.',
    ],
  },
  {
    heading: 'Your responsibilities when contacting people',
    paragraphs: [
      'You are the sender of every message that leaves your workspace. You must follow the laws on unsolicited communication that apply to you and to the people you contact — for example GDPR and PECR in the UK and EU, CAN-SPAM in the United States and CASL in Canada — as well as the rules of each messaging platform you use.',
      'You must honour requests to stop. LeadForge keeps a do-not-contact list and blocks messages to anyone on it; do not work around it. Do not use the service to send deceptive, harassing or unlawful messages, or to contact people about anything illegal.',
    ],
  },
  {
    heading: 'Plans, limits and payment',
    paragraphs: [
      'Each plan includes monthly allowances for leads, AI requests and messages, listed on the pricing page. When an allowance is used up, the action that would exceed it is refused until the next month or until you move to a larger plan.',
      'Paid plans are billed in advance for each billing period and renew automatically until cancelled. You can cancel at any time; the plan stays active until the end of the period already paid for. Except where the law requires otherwise, payments are not refunded for a period that has started.',
      'We may change prices or allowances for future billing periods and will give notice before a change affects you.',
    ],
  },
  {
    heading: 'Your data and ours',
    paragraphs: [
      'The campaigns, notes, messages and settings you create are yours. You give us permission to store and process them so the service can work. Business data obtained from OpenStreetMap remains © OpenStreetMap contributors and is used under the Open Database Licence.',
      'The software, design and brand of LeadForge remain ours or our licensors’. These terms do not transfer them to you.',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: [
      'Do not try to access another workspace’s data, probe or disrupt the service, get round plan limits, resell access without our agreement, or use the service to build a database of people for sale. We may suspend a workspace that puts the service or other people at risk.',
    ],
  },
  {
    heading: 'Ending the agreement',
    paragraphs: [
      'You can stop using LeadForge and ask for your workspace to be deleted at any time. We may suspend or close an account that breaks these terms. If we close an account for a reason other than a breach, we will refund any period paid for and not used.',
    ],
  },
  {
    heading: 'Warranties and liability',
    paragraphs: [
      'The service is provided as it is. We do not promise that it will be uninterrupted, that discovered data is accurate or complete, or that outreach will produce replies or sales.',
      'To the extent the law allows, we are not liable for indirect or consequential loss, lost profit or lost data, and our total liability for any claim is limited to the amount you paid for the service in the twelve months before the claim arose. Nothing here limits liability that cannot legally be limited.',
    ],
  },
  {
    heading: 'Changes to these terms',
    paragraphs: [
      'We may update these terms. If a change is significant we will tell you in the product or by email before it takes effect. Continuing to use the service after that means you accept the updated terms.',
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="2026-10-11"
      intro={`These terms are an agreement between you and ${OPERATOR.name} (“we”, “us”). By creating an account or using LeadForge you accept them.`}
      sections={SECTIONS}
    />
  );
}
