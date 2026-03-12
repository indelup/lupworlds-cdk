# lupworlds-cdk Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-04

## Active Technologies

- TypeScript 5.8 / Node.js 22 + Hono 4.8 (framework + JWT via `hono/jwt`), `@aws-sdk/client-ssm` (new), existing AWS SDK v3 clients (001-auth-permissions)

## Project Structure

```text
apiProxyLambda/          ← Lambda handler: Hono app, routes, middleware
  index.ts               ← App entry point, middleware registration, route mounting
  lib/                   ← Shared helpers (secrets.ts — SSM caching)
  middleware/            ← Cross-cutting middleware (auth.ts, authorization.ts)
  resources/             ← Route handlers per resource (characters, banners, etc.)
  types/                 ← Shared TypeScript types (auth.ts)
lib/                     ← CDK stack definition (lupworlds-cdk-stack.ts)
src/                     ← Additional Lambda handlers (src/user/)
test/                    ← Jest tests
specs/                   ← Feature specs, plans, contracts, tasks per feature branch
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.8 / Node.js 22: Follow standard conventions

## Recent Changes

- 001-auth-permissions: Added TypeScript 5.8 / Node.js 22 + Hono 4.8 (framework + JWT via `hono/jwt`), `@aws-sdk/client-ssm` (new), existing AWS SDK v3 clients

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
