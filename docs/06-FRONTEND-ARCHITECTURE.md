# Frontend Architecture

apps/web/
├── app/
│ ├── (auth)/
│ ├── onboarding/
│ ├── dashboard/
│ │ ├── page.tsx
│ │ ├── campaigns/
│ │ ├── leads/
│ │ ├── conversations/
│ │ ├── analytics/
│ │ ├── settings/
│ │ └── usage/
│ └── layout.tsx
├── components/
│ ├── ui/
│ ├── campaigns/
│ ├── leads/
│ ├── intelligence/
│ ├── outreach/
│ ├── conversations/
│ └── analytics/
├── lib/
├── hooks/
├── stores/
├── types/
└── tests/

## Major screens

Dashboard:

- active campaigns
- funnel
- replies
- meetings
- AI usage

Campaign:

- target criteria
- progress
- metrics
- lead table

Lead intelligence:

- identity
- verification
- evidence
- pain points
- opportunities
- score
- messages
- activity

Conversations:

- inbox
- AI reply suggestion
- status
- handoff
