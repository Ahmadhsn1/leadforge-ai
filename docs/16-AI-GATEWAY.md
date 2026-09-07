# AI Gateway

## Goal

Hide model/provider details from the application.

## Interface

generate(task, input, options)
classify(task, input, options)
extract(task, schema, input, options)

## Providers

V1:

- OpenRouter

Future:

- direct Gemini
- other providers
- local models

## Rules

- browser never calls provider
- API keys server-side
- every result stores provider/model
- every prompt is versioned
- structured outputs are validated

## Return

result
provider
model
usage
latency
request_id
validation_status
