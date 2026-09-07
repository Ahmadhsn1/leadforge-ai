# Discovery Engine

## Goal

Turn a campaign definition into candidate businesses.

## Pipeline

Campaign criteria
→ source adapter
→ query generation
→ pagination
→ raw candidate
→ normalization
→ duplicate detection
→ canonical lead

## Adapter contract

A source adapter should expose:

- search(criteria)
- get_details(external_id)
- normalize(raw)
- source_name()

## V1 source

Google Places/authorized Google location APIs.

## Source isolation

Provider code must not leak into core lead logic.

## Progress

Track:

- candidates discovered
- pages fetched
- leads created
- duplicates
- errors
- rate-limit events

## Failure handling

Transient error → retry.
Provider restriction → pause job.
Permanent malformed result → skip and record error.

## Future sources

CSV import, other authorized directories/data providers.
