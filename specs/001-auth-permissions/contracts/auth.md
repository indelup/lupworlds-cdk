# API Contracts: Authentication & Permissions

**Branch**: `001-auth-permissions`
**Date**: 2026-03-04

All endpoints are served by the Lupworlds Lambda via API Gateway.
Authentication uses `Authorization: Bearer <token>` on all protected routes.

---

## Public Endpoints (no auth required)

### POST /auth/twitch/login

Validates a Twitch access token obtained by the frontend and issues a Lupworlds JWT.
The backend never participates in the OAuth redirect flow — that is handled entirely by the frontend.

**Request Body** (`application/json`):
| Field | Required | Description |
|-------|----------|-------------|
| `accessToken` | Yes | Twitch access token obtained by the frontend |

**Flow**:
1. Calls `GET https://api.twitch.tv/helix/users` with the provided Twitch token to validate it and fetch user info
2. Finds or creates the Lupworlds `User` record (via `TwitchIdIndex`)
3. Issues a Lupworlds JWT

**Success** `200 OK`:
```json
{ "token": "<lupworlds-jwt>" }
```

**Errors**:
| Status | Condition |
|--------|-----------|
| `400` | Missing `accessToken` in body |
| `502` | Twitch API validation failed |
| `500` | Internal error |

---

## Protected Endpoints (require valid Bearer token)

### POST /auth/overlay-token

Issues a read-only overlay JWT scoped to a specific world.
**Required role**: `streamer` — caller must own the requested `worldId`.

**Request Body** (`application/json`):
```json
{
    "worldId": "string"
}
```

**Response** `200 OK`:
```json
{
    "token": "string"
}
```

The returned `token` is a JWT with:
```json
{
    "iss": "lupworlds",
    "aud": "overlay",
    "typ": "overlay",
    "wid": "<worldId>",
    "iat": 1234567890
}
```

**Errors**:
| Status | Condition |
|--------|-----------|
| `401` | No or invalid Bearer token |
| `403` | Caller is not a streamer, or does not own the requested `worldId` |
| `400` | Missing `worldId` in body |

---

## Auth Middleware Behavior (applies to all protected routes)

### Token Extraction

```
Authorization: Bearer <token>
```

### Token Classification

All tokens are JWTs verified with `verify(token, jwtSecret, "HS256")`. There is no raw API key path — the bot also uses a pre-generated JWT stored in SSM.

| Condition | Result |
|-----------|--------|
| Valid JWT, `iss === "lupworlds"` | Dispatch on `payload.typ` (see below) |
| Invalid signature / malformed | `401` |
| No `Authorization` header | `401` |

### JWT Payload → Role Resolution

Dispatched on `payload.typ`:

| `typ` | `aud` check | Resolved `CallerContext` |
|-------|-------------|--------------------------|
| `"access"` | `aud === "api"` | `{ type: "user", userId, platform, platformId, roles, worldId }` |
| `"overlay"` | `aud === "overlay"` | `{ type: "overlay", wid }` |
| `"service"` | `aud === "api"` | `{ type: "bot" }` |
| anything else | — | `401` |

### Error Responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | Missing, malformed, or invalid token |
| `403 Forbidden` | Valid token but insufficient permissions for this operation |

Error body:
```json
{ "error": "string" }
```

---

## Existing Endpoints — Auth Enforcement

All existing routes gain auth enforcement with the RBAC rules from the data model. No request/response shapes change — only requests without a valid credential are now rejected.

| Route | GET | POST / PUT / DELETE |
|-------|-----|---------------------|
| `/characters`, `/materials`, `/actions`, `/banners` | `streamer`, `viewer`, `bot`, `overlay` | `streamer` (own world), `bot` |
| `/worlds/:id` | all | `streamer` (own world), `bot` |
| `/player-data` | `streamer`, `viewer` (own), `bot`, `overlay` | `streamer`, `viewer` (own), `bot` |
| `/users` | `streamer` (own), `viewer` (own), `bot` | `streamer` (own), `viewer` (own), `bot` |
