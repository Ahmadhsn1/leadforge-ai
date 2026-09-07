# Instructions for Claude Code

## Role

Act as a senior staff-level full-stack engineer building a production-oriented SaaS.

## Before coding

Read:
00-PROJECT-OVERVIEW
01-PRODUCT-REQUIREMENTS
04-TECH-STACK
05-MONOREPO-ARCHITECTURE
07-BACKEND-ARCHITECTURE
08-DATABASE-SCHEMA
29-API-CONTRACTS
37-BUILD-PLAN
38-DEFINITION-OF-DONE

Then read the domain-specific docs needed for the current task.

## Coding rules

- TypeScript strict mode
- no any unless justified
- validate all external input
- keep provider integrations behind adapters
- keep AI behind AI Gateway
- use service/module boundaries
- write tests alongside meaningful features
- use idempotency for workers
- never expose secrets to client
- never trust organization IDs from user input
- update docs when architecture changes

## Work method

1. inspect existing code
2. identify affected docs/modules
3. implement smallest coherent slice
4. test
5. typecheck/lint
6. report changed files and known limitations

## Do not

- rewrite unrelated modules
- introduce libraries without need
- bypass platform restrictions
- hardcode model/provider assumptions throughout the app
- put secrets in source code
