# Database Schema Blueprint

## Core tables

users
organizations
memberships
sessions

## Prospect tables

leads
lead_source_records
contacts
social_profiles
evidence
verification_records
intelligence_reports
lead_scores

## Campaign tables

campaigns
campaign_runs
campaign_lead_links

## Outreach tables

message_drafts
outreach_events
outreach_sequences
outreach_steps
conversations
messages
suppressions

## Platform tables

jobs
ai_usage
audit_logs
integrations
subscriptions
usage_counters

## Important keys

Organization-scoped entities carry organization_id.

Lead uniqueness should be based on source identity where available plus canonical identity matching.

## Auditability

AI reports, message drafts and score records retain:

- model
- prompt version
- schema version
- created_at
- source/evidence references
