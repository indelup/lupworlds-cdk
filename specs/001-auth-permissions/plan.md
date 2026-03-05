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
│   └── auth.ts                       NEW — JWT verification, API key check, RBAC enforcement
└── resources/
    └── auth.ts                       NEW — /auth/twitch/callback, /auth/overlay-token

lib/
└── lupworlds-cdk-stack.ts            MODIFY — SSM IAM grant, new env vars

package.json                          MODIFY — add @aws-sdk/client-ssm
```

**Existing resource routers** (`characters.ts`, `materials.ts`, `actions.ts`, `banners.ts`, `worlds.ts`, `users.ts`, `playerData.ts`): modified only to add RBAC checks using `c.get('caller')` context — no structural changes.

**Structure decision**: Single Lambda project (existing). Auth is a middleware layer + one new route module, not a separate Lambda or service.

---

## Implementation Detail

### auth middleware (`middleware/auth.ts`)

Runs on every request except `GET /auth/twitch/callback`.

```
1. Extract Authorization header → strip "Bearer " prefix → 401 if missing
2. verify(token, jwtSecret) from hono/jwt → 401 if signature invalid
3. Validate iss === "lupworlds" → 401 if not
4. Dispatch on payload.typ:
   - "access"  → CallerContext { type: "user", userId: sub, roles, ownedWorldIds, ... }
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

### auth resource (`resources/auth.ts`)

**GET /auth/twitch/callback**:
```
1. Read ?code from query
2. POST https://id.twitch.tv/oauth2/token (exchange code)
3. GET https://api.twitch.tv/helix/users (fetch twitchId + displayName)
4. DynamoDB: QueryCommand on TwitchIdIndex (find existing user)
5. If not found: PutCommand (create new user, id=randomUUID, allowedRoles=["viewer"], ownedWorldIds=[])
6. sign(jwtPayload, jwtSecret) → non-expiring JWT
7. Redirect to FRONTEND_URL?token=<jwt>
```

**POST /auth/overlay-token** (protected, streamer only):
```
1. Auth middleware has already validated caller
2. Check caller.type === "user" && caller.ownedWorldIds.includes(body.worldId) → else 403
3. sign({ ...userClaims, scope: "read", worldId }, jwtSecret)
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
apiLambda.addEnvironment("TWITCH_REDIRECT_URI", "<value>");
apiLambda.addEnvironment("FRONTEND_URL", "<value>");
apiLambda.addEnvironment("JWT_SECRET_PARAM_NAME", "/lupworlds/jwt/secret");
apiLambda.addEnvironment("BOT_API_KEY_PARAM_NAME", "/lupworlds/bot/api-key");
apiLambda.addEnvironment("TWITCH_CLIENT_SECRET_PARAM_NAME", "/lupworlds/twitch/client-secret");
```

### RBAC in existing resource handlers

Each handler reads `c.get('caller')` and applies the matrix. Pattern per handler:

```typescript
// Example: Characters POST
app.post("/", async (c) => {
    const caller = c.get('caller');
    const worldId = body.worldId; // or from query/path

    const isStreamerOfWorld = caller.type === "user"
        && caller.ownedWorldIds?.includes(worldId);
    const isBot = caller.type === "bot";

    if (!isStreamerOfWorld && !isBot) {
        return c.json({ error: "Forbidden" }, 403);
    }
    // ... existing handler logic
});
```

---

## Artifacts Generated

| Artifact | Path | Status |
|----------|------|--------|
| research.md | `specs/001-auth-permissions/research.md` | ✅ Complete |
| data-model.md | `specs/001-auth-permissions/data-model.md` | ✅ Complete |
| contracts/auth.md | `specs/001-auth-permissions/contracts/auth.md` | ✅ Complete |
| quickstart.md | `specs/001-auth-permissions/quickstart.md` | ✅ Complete |
| tasks.md | `specs/001-auth-permissions/tasks.md` | ⏳ Run `/speckit.tasks` |
