# Implementation Plan: Authentication & Role-Based Access Control

**Branch**: `001-auth-permissions` | **Date**: 2026-03-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-auth-permissions/spec.md`

## Summary

Add authentication and world-scoped RBAC to the Lupworlds API. The Lupworlds backend becomes the identity provider: Twitch OAuth2 is used for streamer login, the backend verifies the Twitch identity, creates/finds the internal user, and issues its own non-expiring JWT. All API routes are protected by a global Hono auth middleware that validates Bearer tokens (JWT for users/overlay, static API key for the bot) and enforces the RBAC permission matrix from the constitution before any handler executes.

---

## Technical Context

**Language/Version**: TypeScript 5.8 / Node.js 22
**Primary Dependencies**: Hono 4.8 (framework + JWT via `hono/jwt`), `@aws-sdk/client-ssm` (new), existing AWS SDK v3 clients
**Storage**: DynamoDB — existing `Users` table (no schema changes; `TwitchIdIndex` already in place)
**Testing**: Jest (existing)
**Target Platform**: AWS Lambda (Node.js 22) + API Gateway (proxy)
**Project Type**: Serverless web-service (CDK IaC)
**Performance Goals**: Auth middleware adds < 5ms overhead on warm invocations (SSM values cached at module scope)
**Constraints**: Secrets never in plaintext env vars (constitution rule); no new DynamoDB tables; no new Lambda functions
**Scale/Scope**: Single Lambda, single bot credential, overlay tokens per world

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Serverless-First | ✅ | Auth lives inside the existing Lambda. New SSM params + IAM grant added to CDK stack. No new servers. |
| II. Type-Contract Driven | ✅ | `LupworldsJwtPayload`, `CallerContext`, `Role` types defined in `data-model.md`. Must be in shared types package when it exists; for now co-located in the Lambda. |
| III. Resource-Based Modularity | ✅ | New `middleware/auth.ts` for cross-cutting auth. New `resources/auth.ts` for auth-specific routes (`/auth/*`). Existing resource routers unchanged in structure. |
| IV. Platform-Agnostic Identity | ✅ | Flow: `Twitch OAuth → backend verifies → finds/creates User → issues Lupworlds JWT`. JWT payload contains `platform` + `platformId` fields. Adding YouTube later requires only a new adapter. Twitch token never forwarded to client. |
| V. World-Scoped RBAC | ✅ | Full permission matrix implemented in `middleware/auth.ts` per constitution table. Role resolution per-request from JWT claims. |
| VI. Gacha Server-Side Only | ✅ | Not affected by this feature. |
| VII. Simplicity & YAGNI | ✅ | Non-expiring tokens (no refresh flow). No token registry (revocation deferred). No per-bot-instance scoping. Minimum viable auth. |

**Gate result**: ✅ All principles satisfied. No violations.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-auth-permissions/
├── plan.md              ← this file
├── spec.md
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   └── auth.md          ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks — not yet created)
```

### Source Code Changes

```text
apiProxyLambda/
├── index.ts                          MODIFY — register auth middleware + /auth route
├── middleware/
│   ├── auth.ts                       NEW — JWT verification, CallerContext construction (authentication)
│   └── authorization.ts              NEW — route-level guards: resolveWorldId, requireNotOverlay,
│                                           requireItemWorldWrite, requireWorldWrite (authorization)
├── types/
│   └── auth.ts                       MODIFY — worldId: string in user CallerContext (not ownedWorldIds)
└── resources/
    └── auth.ts                       NEW — /auth/twitch/callback, /auth/overlay-token

lib/
└── lupworlds-cdk-stack.ts            MODIFY — SSM IAM grant, new env vars

package.json                          MODIFY — add @aws-sdk/client-ssm
```

**Existing resource routers** (`characters.ts`, `materials.ts`, `actions.ts`, `banners.ts`, `worlds.ts`, `users.ts`, `playerData.ts`): modified to use authorization middleware at the route level — authorization is resolved before the handler executes. Env var validation moved to module startup (throw on missing vars) instead of per-request checks.

**Structure decision**: Single Lambda project (existing). Auth is a middleware layer + one new route module, not a separate Lambda or service.

---

## Implementation Detail

### auth middleware (`middleware/auth.ts`) — Authentication only

Runs on every request except `POST /auth/twitch/login`.

```
1. Extract Authorization header → strip "Bearer " prefix → 401 if missing
2. verify(token, jwtSecret) from hono/jwt → 401 if signature invalid
3. Validate iss === "lupworlds" → 401 if not
4. Dispatch on payload.typ:
   - "access"  → CallerContext { type: "user", userId: sub, platform, platformId, roles, worldId }
                 Note: worldId is a single string — user tokens are world-scoped at issuance.
                 Switching active worlds requires a new token.
   - "overlay" → CallerContext { type: "overlay", wid, scopes }
                 + validate aud === "overlay"
   - "service" → CallerContext { type: "bot", scopes }
   - unknown   → 401
5. c.set('caller', callerContext)
6. next()
```

SSM values loaded at module scope (cold-start cached Promise):
- `getJwtSecret()` → `/lupworlds/jwt/secret`

No separate bot credential fetch needed — the bot JWT is verified with the same secret as all other tokens.

---

### authorization middleware (`middleware/authorization.ts`) — Authorization only

Route-level guards that run after `auth.ts` has established the caller identity. Applied per-route, not globally.

**`requireNotOverlay`**: blocks overlay callers — used on presigned-url endpoints.

**`resolveWorldId`**: used on POST routes where the entity being created belongs to a world.
```
- overlay  → 403
- user     → worldId = caller.worldId (from token, no body parse needed)
- bot      → worldId = body.worldId (bot operates across worlds; god access, no ownership check)
Sets c.set("worldId", worldId) for the handler to consume.
```

**`requireWorldWrite(param)`**: used on world upsert (PUT /worlds/:id) where worldId is the URL param and the item may not exist yet.
```
- overlay → 403
- user    → check caller.worldId === param value → 403 if mismatch
- bot     → pass
```

**`requireItemWorldWrite(tableName, param)`**: used on PUT/DELETE where the item must exist and its worldId must match the caller.
```
1. Fetch item by id param from DynamoDB → 404 if not found
2. overlay → 403
3. user    → check caller.worldId === item.worldId → 403 if mismatch
4. bot     → pass (god access)
5. c.set("existingItem", item) for the handler
```

Bot always sends worldId in body/item — it has god access and operates across multiple worlds.

### auth resource (`resources/auth.ts`)

**POST /auth/twitch/login** (public):
```
1. Read body.accessToken (Twitch access token obtained by the frontend)
2. GET https://api.twitch.tv/helix/users with Authorization: Bearer <accessToken> + Client-Id header
   → validates token is real; extracts twitchId + displayName
3. DynamoDB: QueryCommand on TwitchIdIndex (find existing user)
4. If not found: PutCommand (create new user, id=randomUUID, allowedRoles=["viewer"], ownedWorldIds=[])
5. sign(jwtPayload, jwtSecret) → non-expiring JWT
6. Return { token: <jwt> }
```

No code exchange, no client secret, no redirect. The backend never handles the OAuth redirect — that's entirely the frontend's responsibility.

**POST /auth/overlay-token** (protected, streamer only):
```
1. Auth middleware has already validated caller
2. Check caller.type === "user" && caller.worldId === body.worldId → else 403
   (token is world-scoped — streamer can only issue overlay tokens for their active world)
3. sign({ ...userClaims, typ: "overlay", aud: "overlay", wid: caller.worldId, scopes }, jwtSecret)
4. Return { token }
```

### CDK changes (`lib/lupworlds-cdk-stack.ts`)

```typescript
// IAM: read all /lupworlds/* SSM parameters
apiLambda.addToRolePolicy(new iam.PolicyStatement({
    actions: ["ssm:GetParameter"],
    resources: [`arn:aws:ssm:${region}:${account}:parameter/lupworlds/*`],
}));

// Non-sensitive env vars
apiLambda.addEnvironment("TWITCH_CLIENT_ID", "<value>");
apiLambda.addEnvironment("JWT_SECRET_PARAM_NAME", "/lupworlds/jwt/secret");
apiLambda.addEnvironment("BOT_JWT_PARAM_NAME", "/lupworlds/bot/jwt");
// TWITCH_REDIRECT_URI and TWITCH_CLIENT_SECRET_PARAM_NAME are NOT needed —
// the frontend handles the OAuth redirect; the backend only validates the token.
```

### RBAC in existing resource handlers

Authorization is resolved in middleware before the handler. Handlers are authorization-free — they only contain business logic.

```typescript
// Example: Characters POST — worldId resolved by middleware before handler runs
app.post("/", resolveWorldId, async (c) => {
    const worldId = c.get("worldId"); // already validated, no auth logic here
    const body = await c.req.json();
    const newCharacter = { ...body, worldId, id: randomUUID(), createdAt: new Date().toISOString() };
    // ... write to DynamoDB
});

// Example: Characters PUT — item fetched and authorized by middleware
app.put("/:id", requireItemWorldWrite(tableName), async (c) => {
    const existing = c.get("existingItem"); // already fetched and authorized
    const updated = await c.req.json();
    // ... S3 cleanup + write to DynamoDB
});
```

Env var validation (`tableName`, `bucketName`) is done at module load time with a `throw` — Lambda fails at cold start if config is missing, not per-request.

---

## Artifacts Generated

| Artifact | Path | Status |
|----------|------|--------|
| research.md | `specs/001-auth-permissions/research.md` | ✅ Complete |
| data-model.md | `specs/001-auth-permissions/data-model.md` | ✅ Complete |
| contracts/auth.md | `specs/001-auth-permissions/contracts/auth.md` | ✅ Complete |
| quickstart.md | `specs/001-auth-permissions/quickstart.md` | ✅ Complete |
| tasks.md | `specs/001-auth-permissions/tasks.md` | ⏳ Run `/speckit.tasks` |
