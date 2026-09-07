# Backend Architecture

apps/api/src/
├── auth/
├── organizations/
├── campaigns/
├── leads/
├── contacts/
├── discovery/
├── normalization/
├── verification/
├── enrichment/
├── intelligence/
├── scoring/
├── personalization/
├── outreach/
├── conversations/
├── crm/
├── analytics/
├── ai/
├── jobs/
├── webhooks/
├── health/
├── common/
└── main.ts

## Module rule

Each module owns:

- controller
- service/application logic
- DTO/input schemas
- repository/data access where needed
- module tests

Cross-module orchestration belongs in application services or job orchestration, not controllers.
