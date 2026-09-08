# Contributing

Thanks for taking the time. This document is short on ceremony and specific
about the things that actually get pull requests rejected here.

## Getting set up

```bash
pnpm install
cp .env.example .env          # then fill in OPENROUTER_API_KEY at minimum
pnpm services                 # postgres + redis (or: pnpm docker:up)
pnpm db:migrate
pnpm db:seed
pnpm dev                      # web :3000, api :4000, worker
```

Node 22.13+, pnpm 11+ (pnpm 11 refuses to run on Node 20). If Docker gives you trouble on Windows, see
[`docs/44-RUNNING-WITHOUT-DOCKER.md`](docs/44-RUNNING-WITHOUT-DOCKER.md) — the
native binaries have no WSL dependency.

## Before you open a pull request

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm format && pnpm test
pnpm test:e2e     # needs postgres running
```

CI runs all of these plus the HTTP and browser smoke suites. `pnpm lint` is
configured with `--max-warnings=0`; a warning is a failure.

## The rules that matter

### Never fabricate data

This is the one principle the whole product rests on. If a value is unknown,
it is `null` — never a plausible-looking substitute.

OpenStreetMap carries no ratings, so the adapter returns `rating: null` rather
than deriving a proxy from something else. A model claim that cannot cite a
stored evidence id is dropped before a user sees it. If you find yourself
writing a fallback that invents a number, stop and surface the absence instead.

### Scores are deterministic

Every scoring dimension is computed in `ScoringService` from stored facts. The
model is asked to _explain_ those numbers and any numbers it returns are
discarded. A score that varies between runs on identical input cannot be
calibrated against outcomes, and cannot be defended to a user who asks why a
lead dropped ten points overnight.

### Model output is data, never instruction

Parse it against a Zod schema. Discard it if it does not validate. Do not
persist unvalidated output, and do not let a model's text reach a code path
that treats it as a command.

### Tenant scope comes from the session

`organizationId` is read from the authenticated session. Never from the body,
path, or query — not even "just for an admin endpoint". Write `findFirst` with
the org id rather than `findUnique` by primary key, so a guessed id returns
nothing.

### Do not run `eslint --fix` blindly on `apps/api` or `apps/worker`

The `consistent-type-imports` rule rewrites Nest constructor imports to
type-only, which erases the runtime class reference that `emitDecoratorMetadata`
needs and silently breaks dependency injection. The rule is disabled for those
directories, with the reason recorded in `eslint.config.mjs`. Please leave it
disabled.

## Comments

Comment the _why_, not the _what_. `// increment i` is noise. A comment that
records why a non-obvious decision was made — a provider quirk, a spec
requirement, a bug that a naive implementation reintroduces — is worth more than
the code around it.

The existing code follows this closely. Match it.

## Tests

New behaviour needs a test. Bug fixes need a test that fails without the fix —
several tests in this repo exist specifically because something passed for the
wrong reason (see `docs/43-IMPLEMENTATION-NOTES.md`).

- unit tests live beside the code as `*.spec.ts`
- E2E lives in `apps/api/test/` and runs against a real database
- `scripts/live-e2e.mjs` runs the real pipeline against real providers; it costs
  AI credits, so it is not part of CI

## Commit messages

Plain, imperative, and about the change:

```
Fix Places discovery sending a circle under locationRestriction

Text Search only accepts a rectangle there and rejects the request
outright. A circle belongs under locationBias.
```

No conventional-commit prefixes required. A body explaining _why_ is welcome
whenever the subject line cannot carry it.

## Reporting bugs

Use the issue templates. A reproduction beats a description; a failing test
beats a reproduction.

## Security

Do not open an issue. Follow [SECURITY.md](SECURITY.md).
