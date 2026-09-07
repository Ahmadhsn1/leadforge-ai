# Security Architecture

## Secrets

Never expose provider/database secrets to frontend.

## Tenant isolation

Every organization-owned query is scoped by organization_id.
Add cross-tenant access tests.

## Web security

- HTTPS
- secure cookies
- CSRF protection where applicable
- rate limiting
- input validation
- output encoding
- SSRF protection
- size/time limits on fetchers
- signed webhook verification

## Data access

Least privilege.

## Audit

Record security-sensitive and important business mutations.

## Backups

Automatic backups plus tested restore procedure.
