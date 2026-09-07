# Testing Strategy

## Unit tests

- normalization
- dedupe
- scoring
- suppression
- prompt building
- schema validation
- model routing
- retry classification

## Integration tests

- Google adapter
- website checker
- OpenRouter provider
- WhatsApp/Meta adapter
- webhooks
- database repositories
- queues

## E2E

Campaign → discovery → verification → enrichment → intelligence → scoring → personalization → approval → mocked outreach → mocked reply → analytics.

## AI evaluation dataset

Maintain fixed examples for:

- factuality
- evidence grounding
- personalization
- classification
- schema compliance

## Quality principle

Provider success != AI quality.
