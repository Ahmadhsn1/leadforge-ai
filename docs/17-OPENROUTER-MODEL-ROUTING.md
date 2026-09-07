# OpenRouter & Model Routing

## Architecture

Application task
→ AI Gateway
→ Model Router
→ OpenRouter
→ selected model

## Router inputs

- task type
- required capabilities
- structured output requirement
- max cost
- latency preference
- allowed models
- denied models

## Routing policy

Use the cheapest model that reliably meets the task quality requirement.

Examples:

- simple category classification → lightweight model
- extraction → structured-output capable model
- complex business analysis → stronger reasoning model
- message generation → instruction-following model

## Free-model policy

Free models can be used for development/MVP capacity, but the product must not assume unlimited free throughput.

## Graceful fallback

If selected model fails:

1. retry if transient
2. choose compatible fallback
3. record failure
4. preserve job state
