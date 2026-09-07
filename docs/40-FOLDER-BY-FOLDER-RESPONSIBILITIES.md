# Folder Responsibilities

## apps/web

UI, routing, server/client components, frontend state.

## apps/api

HTTP boundaries, authentication, authorization, business orchestration, webhooks.

## apps/worker

Long-running asynchronous processors.

## packages/database

Prisma schema, migrations, generated DB client, DB helpers.

## packages/shared

Contracts shared by web/api/worker:
types, validation schemas, events, constants.

## packages/ai

AI Gateway contracts, provider interfaces, task schemas.

## infra

Containers, local orchestration and later deployment infrastructure.

## docs

Product and engineering source-of-truth.

## scripts

One-off operational scripts that are safe and documented.
