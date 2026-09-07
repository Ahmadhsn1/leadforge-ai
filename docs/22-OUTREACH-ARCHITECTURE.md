# Outreach Architecture

## State machine

DRAFT
→ APPROVED
→ QUEUED
→ SENT
→ DELIVERED (where supported)
→ REPLIED
→ FOLLOW_UP_DUE
→ CLOSED

Alternative states:
FAILED
BLOCKED
DO_NOT_CONTACT

## Channel adapter interface

validateRecipient()
createDraft()
send()
schedule()
parseWebhook()
normalizeEvent()

## Core rule

Core outreach logic must not know provider-specific details.

## Suppression check

Perform immediately before queue/send.

## Human control

V1 should make messages reviewable.
