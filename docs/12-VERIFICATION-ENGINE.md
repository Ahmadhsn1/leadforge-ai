# Verification Engine

## Purpose

Separate raw discovery from trusted prospect data.

## Checks

1. Business identity
2. Source freshness
3. Phone format
4. Website reachability
5. Domain/business identity match
6. Social profile validity where permitted
7. Duplicate state
8. Geography/category fit

## Output

verification_status:

- verified
- probable
- needs_review
- rejected

verification_score:
0–100

## Evidence requirement

Every meaningful verification decision should retain what was checked and when.

## Never

Do not mark a lead verified simply because an LLM says it is verified.
Verification is primarily deterministic/provider-backed; AI interprets evidence.
