# Research: Authentication & Role-Based Access Control

**Phase**: 0 — Pre-design research
**Branch**: `001-auth-permissions`
**Date**: 2026-03-04

---

## Decision 1: JWT Library

**Decision**: Use `hono/jwt` built-in (`sign`, `verify` from `hono/jwt`). No additional dependency needed.

**Rationale**: Hono 4.8.0 (already installed) exports `sign()` and `verify()` from `hono/jwt`. Both functions are available:
- `sign(payload, secret, alg?)` → `Promise<string>` — creates a JWT
- `verify(token, secret, alg?)` → `Promise<JWTPayload>` — verifies signature and returns payload
- Default algorithm: HS256 (symmetric, suitable for a single-backend system)

**Non-expiring tokens confirmed**: `verify()` only checks `exp` if the claim is present in the payload (`if (payload.exp && payload.exp <= now)`). A token without `exp` never throws `JwtTokenExpired`. Non-expiring tokens are fully supported without any workaround.

**Alternatives considered**:
- `jose` (standalone JOSE library) — not needed, Hono already bundles this functionality
- `jsonwebtoken` — CommonJS-only, incompatible with Lambda's ESM/bundling setup

---

## Decision 2: JWT Signing Secret Storage

**Decision**: Store the JWT signing secret in **SSM Parameter Store as a SecureString** at `/lupworlds/jwt/secret`. Loaded once at Lambda cold start and cached as a Promise at module scope.

**Rationale**: Constitution rule — secrets never go in Lambda environment variables in plaintext. The Lambda IAM role receives `ssm:GetParameter` + `kms:Decrypt` via CDK `addToRolePolicy`. The parameter name (not its value) is passed as an env var (`JWT_SECRET_PARAM_NAME`).

**Caching pattern** (confirmed best practice):
```ts
let cached: Promise<string> | null = null;

export function getJwtSecret(): Promise<string> {
    if (!cached) cached = fetchFromSSM("/lupworlds/jwt/secret");
    return cached;
}
```
Caching the `Promise` (not the resolved string) prevents duplicate SSM calls on concurrent cold-start invocations.

**Alternatives considered**:
- Lambda env var — rejected, violates constitution security rule
- Secrets Manager — overkill for this use case; SSM SecureString is sufficient and already chosen in the constitution

---

## Decision 3: Bot Authentication Mechanism

**Decision**: The bot uses a **pre-generated JWT** with `typ: "service"`, signed with the same Lupworlds JWT secret, and stored in SSM at `/lupworlds/bot/jwt`. The bot sends it as `Authorization: Bearer <jwt>` like any other caller.

**Rationale**: Using JWT for the bot makes the auth middleware fully uniform — every request goes through `verify()`, and `typ` discriminates the actor type. No special branching needed (no "is this a JWT or an API key?" check). The self-describing payload (`sub: "bot"`, `scopes: ["bot:*"]`) makes the token's purpose explicit.

**Validation flow** (identical to all other tokens):
1. Extract Bearer token from `Authorization` header
2. `verify(token, jwtSecret)` → validates signature
3. Read `payload.typ` → `"service"` → assign bot CallerContext
4. Proceed to handler

**Setup**: The bot JWT is generated once (at setup time or via a management script), signed with the Lupworlds JWT secret, and stored in SSM. When the JWT secret rotates, the bot JWT must be regenerated — acceptable coupling.

**Alternatives considered**:
- Static API key — requires special middleware branching to distinguish from JWTs; rejected in favor of uniform JWT path
- Separate header (`X-Bot-Key`) — deviates from Bearer convention; rejected

---

## Decision 4: Twitch OAuth2 Callback Flow

**Decision**: Lambda exposes a `GET /auth/twitch/callback` endpoint. The frontend constructs and redirects to the Twitch authorization URL. After user approval, Twitch redirects to the Lambda callback which exchanges the code and issues the app JWT.

**Twitch endpoints** (confirmed from Twitch documentation):
- **Token exchange**: `POST https://id.twitch.tv/oauth2/token` with `grant_type=authorization_code`
- **User info**: `GET https://api.twitch.tv/helix/users` — requires both `Authorization: Bearer <twitch_token>` and `Client-Id: <client_id>` headers
- **Scope**: `user:read:email` (conventional minimum; returns `id` and `display_name`)
- Twitch user `id` field is the stable numeric Twitch ID (stored as `twitchId` in our Users table)

**Callback result**: The Lambda redirects the browser to `{FRONTEND_URL}?token=<lupworlds-jwt>`. The frontend reads the token from the URL and stores it (e.g., localStorage).

**Twitch secrets storage**:
- `TWITCH_CLIENT_ID` → Lambda env var (not a secret, can be public)
- `/lupworlds/twitch/client-secret` → SSM SecureString (loaded at cold start, cached)
- `TWITCH_REDIRECT_URI` → Lambda env var (not a secret)
- `FRONTEND_URL` → Lambda env var (for the post-callback redirect)

**Alternatives considered**:
- PKCE flow (frontend-only) — would expose Twitch tokens to the client; rejected per constitution (backend must be the identity provider)
- Implicit flow — deprecated by Twitch; rejected

---

## Decision 5: Overlay Token Issuance

**Decision**: A new endpoint `POST /auth/overlay-token` (streamer-only) accepts a `worldId` in the body and returns a JWT with `scope: "read"` and the requested `worldId` embedded. The overlay presents this token as its Bearer credential.

**Rationale**: The constitution specifies overlay tokens are JWTs with read-only scope scoped to a worldId, issued by the streamer. Using the same JWT infrastructure (same secret, same `verify()` call) keeps the auth middleware uniform.

**Streamer authorization check**: Before issuing the token, the endpoint verifies that the requesting user's `ownedWorldIds` includes the requested `worldId`. A streamer cannot issue an overlay token for another streamer's world.

**Token lifetime**: Non-expiring — consistent with the global no-expiry decision. Revocable by the streamer regenerating a new token (invalidating the old one requires a token registry — deferred to future).

---

## Decision 6: RBAC Enforcement Location

**Decision**: A **single Hono middleware** (`apiProxyLambda/middleware/auth.ts`) applied globally in `index.ts` handles:
1. Token extraction and validation
2. Role determination (streamer vs viewer depends on worldId context per-request)
3. Setting caller context variables on `c` for downstream handlers

**Per-route enforcement**: Each resource handler reads the caller context from `c.get('caller')` and applies resource-specific rules. World-scoped decisions (streamer vs viewer) are made per-request since the worldId is in the request path/body.

**Unprotected routes**: `GET /auth/twitch/callback` (public — it's the OAuth callback). All other routes require a valid credential.

**Alternatives considered**:
- Route-group middleware — more granular but duplicates the validation logic; rejected for simplicity
- AWS API Gateway authorizer (Lambda authorizer) — violates Resource-Based Modularity principle; auth logic would live outside the Hono app; rejected

---

## Decision 7: New Infrastructure (CDK)

**New SSM parameters** (provisioned manually or via CDK with placeholder values):
| Parameter | Type | Description |
|-----------|------|-------------|
| `/lupworlds/jwt/secret` | SecureString | JWT signing secret |
| `/lupworlds/bot/jwt` | SecureString | Bot JWT pre-generado |
| `/lupworlds/twitch/client-secret` | SecureString | Twitch app client secret |

**New Lambda env vars** (non-sensitive):
| Variable | Value |
|----------|-------|
| `TWITCH_CLIENT_ID` | Twitch app client ID |
| `TWITCH_REDIRECT_URI` | Full URL of `/auth/twitch/callback` |
| `FRONTEND_URL` | Dashboard URL for post-auth redirect |
| `JWT_SECRET_PARAM_NAME` | `/lupworlds/jwt/secret` |
| `BOT_JWT_PARAM_NAME` | `/lupworlds/bot/jwt` |
| `TWITCH_CLIENT_SECRET_PARAM_NAME` | `/lupworlds/twitch/client-secret` |

**IAM grant**: `addToRolePolicy` with `ssm:GetParameter` on `arn:aws:ssm:{region}:{account}:parameter/lupworlds/*` — covers all three parameters with one policy statement.

**No new DynamoDB tables needed.** The existing `Users` table (with `TwitchIdIndex` on `twitchId`) is sufficient.

---

## Dependency to Add

```bash
npm install @aws-sdk/client-ssm
```

No other new dependencies — `hono/jwt` is already included in Hono 4.8.0.
