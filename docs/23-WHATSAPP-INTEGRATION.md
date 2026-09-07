# WhatsApp Integration

## Purpose

Provide supported business messaging capabilities.

## Architecture

Lead
→ message draft
→ approval
→ WhatsApp adapter
→ supported WhatsApp Business API
→ webhook
→ normalized event
→ conversation

## Store

provider message ID
status
timestamps
errors

## Webhooks

Verify signatures/tokens.
Process idempotently.

## Important

Do not simulate consumer-client automation or rotate accounts to bypass limits/restrictions.

## Compliance

Build according to the applicable WhatsApp Business/Meta policies, messaging requirements and consent/lawful-contact requirements for the intended market.
