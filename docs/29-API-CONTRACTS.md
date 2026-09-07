# API Contract Blueprint

## Auth

POST /auth/signup
POST /auth/login
POST /auth/logout
GET /auth/me

## Campaigns

POST /campaigns
GET /campaigns
GET /campaigns/:id
PATCH /campaigns/:id
POST /campaigns/:id/start
POST /campaigns/:id/pause

## Leads

GET /leads
GET /leads/:id
PATCH /leads/:id
POST /leads/:id/analyze
POST /leads/:id/generate-message

## Discovery

POST /campaigns/:id/discovery/start
GET /campaigns/:id/discovery/status

## Outreach

GET /outreach/queue
POST /outreach/:id/approve
POST /outreach/:id/cancel

## Conversations

GET /conversations
GET /conversations/:id
POST /conversations/:id/suggest-response

## Analytics

GET /analytics/overview
GET /analytics/campaigns/:id
GET /analytics/ai-usage

## Webhooks

POST /webhooks/:provider

## Contract requirements

- authentication
- organization authorization
- input validation
- request IDs
- consistent error structure
- audit mutations
