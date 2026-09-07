# Monorepo Architecture

leadforge/
├── apps/
│ ├── web/ # Next.js frontend
│ ├── api/ # NestJS HTTP API
│ └── worker/ # BullMQ processors
├── packages/
│ ├── database/ # Prisma schema/migrations/client
│ ├── shared/ # shared types, Zod schemas, constants, events
│ ├── ai/ # reusable AI gateway contracts
│ └── config/ # typed configuration
├── infra/
│ ├── docker/
│ ├── compose/
│ └── deployment/
├── docs/
├── scripts/
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md

## Rules

- business logic does not live in React components
- provider-specific code stays behind adapters
- workers do long-running work
- shared schemas live in packages/shared
- no OpenRouter calls from the browser
- no direct database access from the browser
