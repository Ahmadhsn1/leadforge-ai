# Website Enrichment

## Goal

Determine whether a business has a website and identify useful, observable digital signals.

## Checks

- HTTP status
- HTTPS
- redirects
- title
- business identity
- mobile/basic UX signals
- contact page
- booking CTA
- menu/product/service page
- visible conversion CTA
- obvious brokenness

## Safety

The URL fetcher must protect against SSRF:

- reject private network targets
- validate redirects
- restrict schemes
- enforce timeouts
- limit response size
- sanitize extracted text

## Output example

website_status = none | active | broken | uncertain
opportunity_signals = []
confidence = number
evidence_ids = []
