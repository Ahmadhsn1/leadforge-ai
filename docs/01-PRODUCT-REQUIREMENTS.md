# Product Requirements Document

## Problem

Sales teams and agencies waste time finding businesses, checking whether they fit, researching weaknesses, and writing personalized outreach.

## Solution

LeadForge automates the research pipeline while keeping the final sales decision understandable and controllable.

## Functional requirements

### Campaigns

Users can define:

- geography
- industry/category
- lead count
- rating/review thresholds
- website conditions
- social presence conditions
- contactability requirements
- custom qualification rules
- AI objective
- outreach channel

### Leads

Each lead should have:

- canonical business identity
- source
- contact data
- verification
- enrichment
- evidence
- AI intelligence
- score
- messages
- activity timeline
- CRM status

### AI

AI should provide:

- summary
- strengths
- pain points
- opportunities
- confidence
- recommended angle
- score explanation
- personalized drafts
- reply classification
- suggested responses

## Non-functional requirements

- tenant isolation
- secure secrets
- retryable workers
- observable pipelines
- stable API contracts
- strong validation
- graceful provider failures
- auditability

## V1 success criterion

A user can create a campaign and reliably receive a ranked, explainable set of prospects with useful personalized message drafts.
