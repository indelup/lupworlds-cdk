# Data Model: Authentication & Role-Based Access Control

**Branch**: `001-auth-permissions`
**Date**: 2026-03-04

---

## Existing Entities (Updated)

### User *(existing table — schema extended)*

The `Users` DynamoDB table already exists. The following fields are expected at the application layer (no schema migration needed — DynamoDB is schemaless):

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | Internal stable ID — never changes |
| `twitchId` | `string` | Twitch numeric user ID (indexed via `TwitchIdIndex`) |
| `displayName` | `string` | Twitch display name at last login |
| `allowedRoles` | `Role[]` | Roles globally assigned to this user (e.g., `["streamer"]`) |
| `ownedWorldIds` | `string[]` | World IDs this user owns as a streamer (empty for viewers) |
| `createdAt` | `string` (ISO 8601) | Account creation timestamp |

**Notes**:
- The existing code uses `worldIds` in some places. Going forward, `ownedWorldIds` is the canonical field name (matches constitution and JWT payload).
- `allowedRoles` determines if a user can act as a streamer globally. Per-world role resolution happens at request time based on `ownedWorldIds`.

---

## New Types (Application Layer Only — no new DynamoDB tables)

### Role

```typescript
type Role = "streamer" | "viewer" | "bot" | "overlay";
```

- `streamer` — a user who owns worlds and manages their configuration
- `viewer` — a user participating in a world during a stream
- `bot` — internal service credential; not a user account
- `overlay` — internal service credential; read-only, world-scoped

### AccessTokenPayload (user/streamer/viewer)

```typescript
interface AccessTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "access";
    sub: string;              // userId interno (User.id — UUID estable)
    iat: number;              // Unix timestamp de emisión
    platform: string;         // "twitch" | futuros proveedores
    platformId: string;       // ID del proveedor (e.g., twitchId)
    roles: Role[];            // Roles asignados globalmente (e.g., ["streamer"])
    ownedWorldIds: string[];  // Worlds que posee ([] para viewers)
}
```

### OverlayTokenPayload

```typescript
interface OverlayTokenPayload {
    iss: "lupworlds";
    aud: "overlay";
    typ: "overlay";
    wid: string;              // worldId al que está restringido
    scopes: OverlayScope[];   // Permisos explícitos de lectura
    iat: number;
}

type OverlayScope = "world:read" | "playerdata:read";
```

### ServiceTokenPayload (bot)

```typescript
interface ServiceTokenPayload {
    iss: "lupworlds";
    aud: "api";
    typ: "service";
    sub: "bot";               // Identificador del servicio
    scopes: ["bot:*"];
    iat: number;
}
```

**Ningún token lleva `exp`** — tokens no expiran en esta fase. `hono/jwt`'s `verify()` omite la validación de expiración cuando `exp` está ausente.

### CallerContext

Set on the Hono context by the auth middleware; available to all downstream handlers:

```typescript
type CallerContext =
    | {
          type: "user";
          userId: string;
          platform: string;
          platformId: string;
          roles: Role[];
          ownedWorldIds: string[];
      }
    | {
          type: "overlay";
          wid: string;           // world al que está restringido
          scopes: OverlayScope[];
      }
    | {
          type: "bot";
          scopes: ["bot:*"];
      };
```

### TwitchUserInfo

Shape of the relevant fields from `GET https://api.twitch.tv/helix/users`:

```typescript
interface TwitchUserInfo {
    id: string;           // Twitch numeric user ID
    display_name: string; // Twitch display name
    email?: string;       // Present only if user:read:email scope was granted
}
```

---

## SSM Parameter Registry

These parameters are provisioned outside of DynamoDB (infrastructure layer). Defined here for reference:

| Parameter Path | Type | Consumed By |
|----------------|------|-------------|
| `/lupworlds/jwt/secret` | SecureString | Auth middleware (JWT sign/verify) |
| `/lupworlds/bot/jwt` | SecureString | Bot JWT pre-generado (firmado con el mismo secret) |
| `/lupworlds/twitch/client-secret` | SecureString | Auth callback (code exchange) |

---

## RBAC Permission Matrix

Derived directly from the constitution (World-Scoped RBAC, Section V):

| Resource | streamer (own world) | viewer | bot | overlay |
|----------|---------------------|--------|-----|---------|
| Characters / Materials / Actions / Banners — GET | ✓ | ✓ | ✓ | ✓ |
| Characters / Materials / Actions / Banners — POST / PUT / DELETE | ✓ | ✗ | ✓ | ✗ |
| Worlds — GET | ✓ | ✓ | ✓ | ✓ |
| Worlds — PUT / DELETE | ✓ (own world only) | ✗ | ✓ | ✗ |
| PlayerWorldData — GET | ✓ | ✓ (own record only) | ✓ | ✓ |
| PlayerWorldData — PUT | ✓ | ✓ (own record only) | ✓ | ✗ |
| Users — GET / PUT | ✓ (own record only) | ✓ (own record only) | ✓ | ✗ |
| `POST /auth/overlay-token` | ✓ (own world only) | ✗ | ✗ | ✗ |

**Role resolution rules** (per request):
1. Caller type `bot` → bot role (all writes allowed per matrix above)
2. Caller type `overlay` → overlay role (read-only, scoped to `worldId` in token)
3. Caller type `user`:
   - If the requested `worldId` is in `caller.ownedWorldIds` → streamer role for this request
   - Otherwise → viewer role for this request
4. Viewer self-scope: enforced per handler — viewer can only read/write their own `userId` in PlayerWorldData and Users
