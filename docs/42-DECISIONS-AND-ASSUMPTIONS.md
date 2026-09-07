# Architecture Decisions & Assumptions

## Decision 1

PostgreSQL instead of MongoDB because the product has strong relational/transactional workflows.

## Decision 2

NestJS backend to keep module boundaries explicit.

## Decision 3

BullMQ for long-running pipelines.

## Decision 4

AI Gateway separates application logic from model/provider choice.

## Decision 5

OpenRouter is the first AI provider; free models are treated as MVP capacity, not guaranteed permanent production capacity.

## Decision 6

Evidence is a first-class entity.

## Decision 7

Automated outreach is not the first proof of value. Prospect quality and personalization come first.

## Assumptions to revisit

- exact source provider fields
- provider pricing/limits
- supported Meta/WhatsApp use cases
- legal/contact rules by market
- billing model
