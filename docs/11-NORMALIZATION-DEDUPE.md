# Normalization & Deduplication

## Normalization

- lowercase comparison forms
- trim whitespace
- normalize phone to canonical format
- canonicalize URLs
- normalize address fields
- normalize business category

## Exact identifiers

Prefer provider external IDs.

## Fuzzy matching signals

- business name
- phone
- website/domain
- address
- coordinates

## Merge policy

High confidence → auto-merge.
Medium confidence → mark for review.
Low confidence → keep separate.

## Idempotency

The same source record must not create duplicate leads after retries.
