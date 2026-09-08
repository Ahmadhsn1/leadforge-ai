# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's [Report a vulnerability][advisory] form on
this repository. That opens a draft advisory visible only to maintainers.

Please include:

- what an attacker can do, and what they need to start (a session? an org
  member's role? nothing?)
- the smallest reproduction you have
- affected commit or version

You will get an acknowledgement within 72 hours, an assessment within 7 days,
and credit in the advisory unless you would rather stay anonymous.

Findings that are already covered by the "Known limits" section below are still
worth reporting if you can show real impact — but expect a faster "working as
designed" response.

[advisory]: https://github.com/Ahmadhsn1/leadforge-ai/security/advisories/new

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`  | ✅        |
| < 1.0   | ❌        |

---

## What the codebase already does

These are load-bearing decisions, not aspirations. If you find a place where one
of them does not hold, that is a bug worth reporting.

### Tenant isolation

`organizationId` is read from the authenticated session and never from the
request body, path or query. Every Prisma query that touches tenant data carries
it in the `where` clause, including the ones that look like they cannot need it
(`findUnique` by primary key is written as `findFirst` with the org id, so a
guessed id returns nothing rather than another tenant's row).

Both the E2E suite and the HTTP smoke suite assert isolation on every read and
write path.

### Sessions

Opaque random tokens in `httpOnly`, `SameSite=Lax`, `Secure` cookies —
never JWTs in local storage. Only the SHA-256 hash is stored, so a database
dump does not yield usable sessions. The browser never talks to the API
directly: it calls the Next.js app's own origin, which proxies server-side, so
the token is never exposed to client JavaScript.

### Passwords

argon2id with per-user salts. Login and signup are rate limited. Failures are
answered with the same generic message and comparable timing, so the endpoint
does not confirm whether an address is registered.

### SSRF

Enrichment fetches lead websites, which means it fetches attacker-influenced
URLs. Before every request and again after **every redirect hop**, the target is
resolved and checked: private, loopback, link-local and cloud-metadata ranges
are refused. Responses are capped by byte count and wall-clock time. Only
`http` and `https` are permitted.

### Prompt injection

Model output is never trusted as instruction or as fact:

- every response is parsed against a Zod schema; invalid output is discarded
  rather than persisted
- claims that do not cite a stored evidence id are dropped before they reach
  the user
- scores are computed deterministically in code — the model only explains
  numbers it cannot change
- generated messages pass a deterministic rule engine before an adversarial
  model check, and the rule engine's verdict cannot be argued with

### Secrets

Configuration is validated with Zod at boot; the API refuses to start in
production without the variables it needs. Secrets are never logged — the
logger redacts known-sensitive keys — and `.env` is git-ignored.

### Outreach safety

Suppression is re-checked immediately before a message leaves, not only at
approval time, because a do-not-contact request that arrives while a message is
queued must still win. Sends are idempotent on a deterministic key, so a retried
job cannot send twice.

---

## Known limits

Stated openly so you can judge the risk yourself.

- **No CSRF tokens.** Session cookies are `SameSite=Lax` and every mutating
  route is `POST`/`PATCH`/`DELETE` with a JSON content type, which blocks the
  classic form-based attack. A token layer would still be an improvement.
- **No 2FA.** Password plus session only.
- **Rate limits are per instance**, held in memory. Behind several replicas the
  effective limit multiplies by the replica count. A shared Redis limiter is the
  fix.
- **Audit log is append-only by convention**, not enforced by database
  permissions.
- **The `manual` outreach channel trusts the user's confirmation** that they
  sent a message. There is no provider receipt behind it, and the data model
  says so rather than implying delivery.

## Dependency advisories

Runtime and build dependencies are kept clear of known advisories. The full
tree currently carries none.

Where a direct dependency vendors a package that has an advisory and has not
released a fix, `overrides` in `pnpm-workspace.yaml` lifts it for the whole
tree. Four packages are pinned that way today:

| Package        | Pinned to | Why                                                                       |
| -------------- | --------- | ------------------------------------------------------------------------- |
| `postcss`      | `^8.5.23` | Next 15 vendors 8.4.31, which has path-traversal and XSS advisories.      |
| `esbuild`      | `^0.25.0` | Older builds let any website read the dev server's responses.             |
| `vite`         | `^7.3.6`  | Path traversal in optimised-dep `.map` handling, and an `fs.deny` bypass. |
| `deepmerge-ts` | `^8.0.0`  | `@prisma/config` pins 7.1.5, which has a stack-exhaustion advisory.       |

Note that pnpm 11 reads `overrides` from `pnpm-workspace.yaml`. A `pnpm.overrides`
block in `package.json` is **ignored** — with nothing worse than an install
warning to tell you — so an override placed there looks applied and is not.

After changing a pinned version, check the whole tree actually moved:

```bash
grep -oE "^  postcss@[0-9][^:(]*" pnpm-lock.yaml | sort -u
```

## Scope

In scope: this repository's code and configuration.

Out of scope: vulnerabilities in third-party services (OpenRouter, Google
Places, Meta, OpenStreetMap infrastructure) — report those to the vendor;
findings that require a compromised host or a malicious maintainer; missing
hardening headers with no demonstrated impact.
