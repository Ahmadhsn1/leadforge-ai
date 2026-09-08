## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The reasoning. If this fixes a bug, what caused it? Link the issue. -->

Closes #

## How it was verified

<!-- Say what you actually ran, not what you intended to run. -->

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e` (needs Postgres)
- [ ] Exercised manually — describe how:

## Checklist

- [ ] New behaviour has a test; a bug fix has a test that fails without the fix
- [ ] No fabricated data — unknown values are `null`, not plausible substitutes
- [ ] Any AI-derived claim cites stored evidence
- [ ] `organizationId` comes from the session, never from client input
- [ ] Comments explain _why_, not _what_
- [ ] Docs updated if behaviour or configuration changed
