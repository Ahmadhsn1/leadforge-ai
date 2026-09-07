# Technology Decisions

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Query/TanStack Query where appropriate

## Backend

- Node.js
- TypeScript
- NestJS
- REST API
- Zod/class-validator style request validation

## Database

- PostgreSQL
- Prisma ORM

## Async infrastructure

- Redis
- BullMQ

## AI

- internal AI Gateway
- OpenRouter as first provider
- model routing
- structured output validation
- provider fallback capability

## Storage

- S3-compatible object storage when assets are necessary

## Auth

Use a secure managed or self-hosted authentication system with server-side session validation.

## Deployment

Dockerized services with managed Postgres/Redis in production.

## Observability

- structured logs
- request/job IDs
- OpenTelemetry
- error monitoring

## Why PostgreSQL

The domain is relational: users, organizations, campaigns, leads, evidence, messages, conversations, jobs, usage and billing all have strong relationships and transactional requirements.
