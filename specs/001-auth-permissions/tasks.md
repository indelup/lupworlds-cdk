# Tasks: Authentication & Role-Based Access Control

**Input**: Design documents from `/specs/001-auth-permissions/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.
**Tests**: Not included (not requested in spec).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, provision secrets, wire CDK infrastructure

- [ ] T001 Install `@aws-sdk/client-ssm` dependency in `package.json`
- [ ] T002 [P] Provision SSM SecureString parameters (`/lupworlds/jwt/secret`, `/lupworlds/bot/jwt`, `/lupworlds/twitch/client-secret`) in AWS as documented in `quickstart.md`
- [ ] T003 [P] Create `apiProxyLambda/middleware/` directory and `apiProxyLambda/resources/auth.ts` placeholder file stubs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared types, SSM helper, and CDK wiring that MUST be complete before any user story

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Define shared TypeScript types (`Role`, `AccessTokenPayload`, `OverlayTokenPayload`, `ServiceTokenPayload`, `CallerContext`, `TwitchUserInfo`) in `apiProxyLambda/types/auth.ts`. User `CallerContext` uses `worldId: string` (single world, token-scoped) — NOT `ownedWorldIds: string[]`. `AppEnv.Variables` includes `caller`, `worldId`, and `existingItem`.
- [ ] T005 [P] Implement SSM secret-loading helper with module-scope Promise cache (`getJwtSecret`, `getBotJwt`, `getTwitchClientSecret`) in `apiProxyLambda/lib/secrets.ts`
- [ ] T006 Implement global auth middleware (`apiProxyLambda/middleware/auth.ts`): extract Bearer token, `verify()` with `hono/jwt`, dispatch on `payload.typ` (`access` / `overlay` / `service`), set `c.set('caller', callerContext)`, skip for `GET /auth/twitch/callback`. For `access` tokens, `CallerContext` uses `worldId: string` (not `ownedWorldIds`).
- [ ] T006b Implement authorization middleware (`apiProxyLambda/middleware/authorization.ts`): `requireNotOverlay`, `resolveWorldId` (worldId from token for user, from body for bot; blocks overlay), `requireWorldWrite(param)` (for world upsert by URL param), `requireItemWorldWrite(tableName, param)` (fetch item + world-scope check + expose via context). Bot has god access in all write guards.
- [ ] T007 Register auth middleware and `/auth` route group in `apiProxyLambda/index.ts`
- [ ] T008 Update CDK stack (`lib/lupworlds-cdk-stack.ts`): add `ssm:GetParameter` IAM policy for `arn:aws:ssm:{region}:{account}:parameter/lupworlds/*` and set non-sensitive env vars (`TWITCH_CLIENT_ID`, `TWITCH_REDIRECT_URI`, `FRONTEND_URL`, `JWT_SECRET_PARAM_NAME`, `BOT_JWT_PARAM_NAME`, `TWITCH_CLIENT_SECRET_PARAM_NAME`)

**Checkpoint**: Auth middleware is active; all requests (except the OAuth callback) return 401 without a token. CDK deploys cleanly.

---

## Phase 3: User Story 1 — Streamer Login via Twitch (Priority: P1) MVP

**Goal**: A streamer completes the Twitch OAuth2 flow and receives a Lupworlds JWT. All their world management routes accept that JWT and enforce world-ownership.

**Independent Test**: Visit the Twitch OAuth URL, approve, land on `FRONTEND_URL?token=<jwt>`, decode the JWT and confirm `typ: "access"`, `roles: ["streamer"]`, `ownedWorldIds`. Then call `GET /characters?worldId=<ownedId>` with the token — 200. Call with another worldId — 403.

### Implementation for User Story 1

- [ ] T009 [US1] Implement `GET /auth/twitch/callback` in `apiProxyLambda/resources/auth.ts`: exchange `?code` for a Twitch access token (`POST https://id.twitch.tv/oauth2/token`), fetch user info (`GET https://api.twitch.tv/helix/users`), find-or-create `User` record via `TwitchIdIndex` in DynamoDB, sign `AccessTokenPayload` with `hono/jwt`, redirect to `{FRONTEND_URL}?token=<jwt>`
- [ ] T010 [US1] Apply authorization middleware to `apiProxyLambda/resources/characters.ts`: POST uses `resolveWorldId`, PUT/DELETE use `requireItemWorldWrite(tableName)`, presigned-url uses `requireNotOverlay`. Handlers are authorization-free. Env var validation at module startup.
- [ ] T011 [P] [US1] Apply authorization middleware to `apiProxyLambda/resources/materials.ts` (same pattern as T010)
- [ ] T012 [P] [US1] Apply authorization middleware to `apiProxyLambda/resources/actions.ts` (same pattern as T010)
- [ ] T013 [P] [US1] Apply authorization middleware to `apiProxyLambda/resources/banners.ts` (same pattern as T010)
- [ ] T014 [US1] Apply authorization middleware to `apiProxyLambda/resources/worlds.ts`: PUT uses `requireWorldWrite()` (worldId is URL param, upsert — item may not exist), presigned-url uses `requireNotOverlay`. GET allows all authenticated callers.
- [ ] T015 [US1] Add RBAC guards to `apiProxyLambda/resources/users.ts`: GET/PUT allowed only for streamer or viewer acting on their own `userId`, or bot

**Checkpoint**: US1 fully functional. Streamer logs in via Twitch, receives JWT, can manage their own world resources, is denied access to another streamer's world.

---

## Phase 4: User Story 2 — Internal Bot Executing Game Actions (Priority: P2)

**Goal**: The bot authenticates with its pre-generated service JWT (stored in SSM) and can call any game-action endpoint. Invalid/missing bot credentials are rejected.

**Independent Test**: Retrieve bot JWT from SSM, call `POST /actions` with `Authorization: Bearer <bot-jwt>` → 200. Call with a tampered JWT → 401. Call `DELETE /characters/:id` as bot → confirm allowed. Call `DELETE /characters/:id` as viewer → 403.

### Implementation for User Story 2

- [ ] T016 [US2] Verify the auth middleware (T006) correctly handles `typ: "service"` — sets `CallerContext { type: "bot", scopes: ["bot:*"] }` (no new code if T006 is complete; add integration smoke test against bot JWT from SSM)
- [ ] T017 [US2] Confirm RBAC in `apiProxyLambda/resources/characters.ts`, `materials.ts`, `actions.ts`, `banners.ts` grants bot write access (covered by T010–T013; verify bot path through each guard explicitly)
- [ ] T018 [US2] Confirm RBAC in `apiProxyLambda/resources/worlds.ts` grants bot PUT/DELETE access (covered by T014; verify)
- [ ] T019 [US2] Confirm RBAC in `apiProxyLambda/resources/playerData.ts`: add guards — bot can GET/PUT PlayerWorldData for any world; streamer can GET/PUT for own world; viewer can GET/PUT only own record; overlay can GET only

**Checkpoint**: US2 fully functional. Bot JWT authenticates and executes game actions. Invalid credentials return 401/403.

---

## Phase 5: User Story 3 — OBS Overlay Read-Only Access (Priority: P3)

**Goal**: A streamer issues a read-only overlay JWT scoped to their world. The overlay can query world state. Any write attempt is rejected with 403.

**Independent Test**: Call `POST /auth/overlay-token` with streamer JWT and `{"worldId":"<ownedId>"}` → receive overlay JWT. Use overlay JWT to `GET /characters?worldId=<ownedId>` → 200. Try `POST /characters` → 403. Try querying a different worldId → 403.

### Implementation for User Story 3

- [ ] T020 [US3] Implement `POST /auth/overlay-token` in `apiProxyLambda/resources/auth.ts`: validate `caller.type === "user" && caller.worldId === body.worldId` (token is world-scoped — streamer can only issue overlay tokens for their active world), sign `OverlayTokenPayload` (`typ: "overlay"`, `aud: "overlay"`, `wid: caller.worldId`, `scopes: ["world:read","playerdata:read"]`), return `{ token }`
- [ ] T021 [US3] Enforce overlay world-scope in auth middleware (`apiProxyLambda/middleware/auth.ts`): when `caller.type === "overlay"`, verify the request's `worldId` (query param or path) matches `caller.wid`; reject mismatches with 403
- [ ] T022 [US3] Enforce overlay read-only in existing resource guards: characters, materials, actions, banners, worlds — POST/PUT/DELETE must explicitly reject `caller.type === "overlay"` (audit all guards added in T010–T014 and add overlay check where missing)

**Checkpoint**: US3 fully functional. Overlay token issued by streamer, read-only access confirmed, write and cross-world attempts rejected.

---

## Phase 6: User Story 4 — Viewer Participating in a World (Priority: P4)

**Goal**: A viewer with a valid access JWT (issued via Twitch login, `roles: ["viewer"]`) can read and update only their own PlayerWorldData. World configuration resources are read-only for them.

**Independent Test**: Authenticate as a viewer (no `ownedWorldIds`). Call `GET /player-data?worldId=<id>&userId=<ownerId>` → 200 for own record. Call with another userId → 403. Call `POST /characters` → 403.

### Implementation for User Story 4

- [ ] T023 [US4] Enforce viewer self-scope in `apiProxyLambda/resources/playerData.ts`: viewer can only GET/PUT records where `body.userId === caller.userId` or query param `userId === caller.userId`; reject other userId with 403
- [ ] T024 [US4] Enforce viewer self-scope in `apiProxyLambda/resources/users.ts`: viewer GET/PUT only allowed when path/query `userId === caller.userId`
- [ ] T025 [US4] Verify viewer is denied POST/PUT/DELETE on characters, materials, actions, banners, worlds — confirm existing guards from T010–T014 cover the viewer case (no `ownedWorldIds` → not streamer → viewer → blocked on writes)

**Checkpoint**: US4 fully functional. Viewers access only their own data; world configuration is read-only for them.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, cleanup, and validation across all stories

- [ ] T026 [P] Audit all resource handlers (`characters.ts`, `materials.ts`, `actions.ts`, `banners.ts`, `worlds.ts`, `playerData.ts`, `users.ts`) for missing `c.get('caller')` guards — confirm 100% of routes require authentication (SC-002)
- [ ] T027 [P] Add `400` error handling to `GET /auth/twitch/callback` (missing `code`) and `POST /auth/overlay-token` (missing `worldId`) in `apiProxyLambda/resources/auth.ts`
- [ ] T028 Run `npm test && npm run lint` and fix any issues
- [ ] T029 Validate the full quickstart.md flow end-to-end against a deployed dev stack (streamer login, bot request, overlay token issuance, viewer access)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — no dependency on US2/US3/US4
- **US2 (Phase 4)**: Depends on Phase 2 — largely validates Phase 3 guards; independently testable
- **US3 (Phase 5)**: Depends on Phase 2 — independently testable; adds overlay token endpoint
- **US4 (Phase 6)**: Depends on Phase 2 — viewer self-scope adds to Phase 3/4 guards
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational complete — no story dependencies
- **US2 (P2)**: Foundational complete — reuses US1 resource guards (T010–T015) but independently testable via bot JWT path
- **US3 (P3)**: Foundational complete — adds overlay token endpoint; overlay scope enforcement independent
- **US4 (P4)**: Foundational complete — reuses resource guards from US1; viewer self-scope is additive

### Within Each User Story

- Types → secrets helper → middleware → CDK (Phases 2 order)
- Auth callback before resource guards (T009 before T010–T015)
- Parallel [P] tasks (T010, T011, T012, T013) can run simultaneously on separate files
- Overlay token endpoint (T020) before scope enforcement (T021–T022)

### Parallel Opportunities

- T002, T003 (Phase 1) run in parallel
- T005 (secrets helper) runs in parallel with T004 (types)
- T011, T012, T013 (materials, actions, banners guards) run in parallel after T010
- T017, T018, T019 (bot validation in US2) can run in parallel
- T026, T027, T028 (polish) run in parallel

---

## Parallel Example: User Story 1

```bash
# After T009 (auth callback) completes, launch resource guards in parallel:
Task T010: RBAC guards in apiProxyLambda/resources/characters.ts
Task T011: RBAC guards in apiProxyLambda/resources/materials.ts  [P]
Task T012: RBAC guards in apiProxyLambda/resources/actions.ts    [P]
Task T013: RBAC guards in apiProxyLambda/resources/banners.ts    [P]
# Then sequentially:
Task T014: RBAC guards in apiProxyLambda/resources/worlds.ts
Task T015: RBAC guards in apiProxyLambda/resources/users.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Streamer can log in via Twitch and manage their own world
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → API rejects all unauthenticated requests
2. US1 → Streamer login + world-scoped RBAC (MVP)
3. US2 → Bot authentication + game actions (live redemptions work)
4. US3 → Overlay token issuance + read-only enforcement (OBS overlays work)
5. US4 → Viewer self-scope (viewer profile pages work)
6. Polish → Hardening, lint, end-to-end validation

### Parallel Team Strategy

With multiple developers:

1. Team completes Phase 1 + Phase 2 together
2. Once Foundational is done:
   - Developer A: US1 (Twitch callback + resource guards)
   - Developer B: US2 (bot validation — can verify against US1 guards)
   - Developer C: US3 (overlay token endpoint + scope enforcement)
3. US4 viewer self-scope added by any developer after US1 guards are in place

---

## Notes

- [P] tasks operate on different files — no merge conflicts
- Each user story phase ends with an independent checkpoint that can be deployed and demoed
- Secrets (JWT secret, bot JWT, Twitch client secret) must be provisioned in SSM before any local or deployed testing
- The auth middleware skip-list contains only `GET /auth/twitch/callback` — all other routes must be authenticated
- `hono/jwt` `verify()` omits expiry check when `exp` is absent — non-expiring tokens require no workaround
- Bot JWT is a pre-generated signed JWT stored in SSM (not a raw API key); the middleware validates it identically to user tokens
