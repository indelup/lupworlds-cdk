# Feature Specification: Authentication & Role-Based Access Control

**Feature Branch**: `001-auth-permissions`
**Created**: 2026-03-04
**Status**: Draft
**Input**: User description: "Lupworlds necesita implementar un sistema de autenticación y control de permisos para proteger su API y permitir que diferentes actores interactúen con la plataforma de forma segura."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Streamer Login via Twitch (Priority: P1)

A streamer opens the Lupworlds dashboard and is prompted to sign in. They click "Login with Twitch", are redirected to Twitch's authorization page, grant permissions, and are returned to the dashboard fully authenticated. From that point on, they can manage their world — creating and editing characters, banners, materials, and actions — without having to log in again until their session expires.

**Why this priority**: All other streamer functionality depends on knowing who the streamer is. Without authentication, no streamer-specific feature can work. This is the foundation of the platform's security model.

**Independent Test**: A fresh user visits the dashboard, completes the Twitch login flow, and can successfully access their world management pages. Delivers value immediately: the streamer can see and edit their own world.

**Acceptance Scenarios**:

1. **Given** a streamer is not authenticated, **When** they navigate to the dashboard, **Then** they are redirected to the Twitch authorization page and cannot access protected pages.
2. **Given** a streamer completes the Twitch authorization flow, **When** they are returned to the dashboard, **Then** they are logged in, their identity is confirmed, and their session is established.
3. **Given** a streamer is authenticated, **When** they attempt to manage their world's characters/banners/materials/actions, **Then** all operations succeed and are scoped exclusively to their own world.
4. **Given** a streamer is authenticated, **When** they attempt to access or modify another streamer's world resources, **Then** the request is denied with an appropriate error.
5. **Given** a streamer's token has been explicitly revoked, **When** they attempt any authenticated action, **Then** they are prompted to log in again.

---

### User Story 2 - Internal Bot Executing Game Actions (Priority: P2)

The Twitch channel-point redemption bot needs to trigger in-game actions (e.g., apply a material to a player, activate a character ability) on behalf of viewers during a live stream. The bot authenticates once using a pre-shared credential issued to it, and then calls the API to execute game actions. The API validates the bot's identity and grants it elevated permissions to modify game state beyond what a regular viewer can do.

**Why this priority**: The bot is the core real-time gameplay mechanic — without it, Twitch redemptions have no effect in the game. It must be secured but also reliable, so it comes before viewer self-service.

**Independent Test**: A bot client authenticates using its pre-shared credential, then calls the "execute action" endpoint with a valid world and action ID. The action is applied and confirmed. Delivers value: live redemptions affect the game world.

**Acceptance Scenarios**:

1. **Given** the bot has a valid service credential, **When** it calls a game-action endpoint, **Then** the action is executed and the game state is updated.
2. **Given** a request arrives claiming to be the bot but with an invalid or missing credential, **When** it reaches the API, **Then** it is rejected with a 401/403 and no action is executed.
3. **Given** the bot is authenticated, **When** it attempts to call an endpoint reserved for streamers (e.g., delete a character), **Then** the request is denied — the bot cannot exceed its permitted scope.
4. **Given** the bot credential is rotated, **When** the bot uses the new credential, **Then** authentication succeeds; the old credential is rejected.

---

### User Story 3 - OBS Overlay Read-Only Access (Priority: P3)

A streamer has an OBS overlay browser source that queries the Lupworlds API for the current world state (active characters, banners, player scores, etc.) to render on-screen during the stream. The overlay authenticates using a short-lived, read-only token scoped to a specific world, and polls the API for updates. It cannot modify any data.

**Why this priority**: Overlays enhance the streaming experience but are not essential to the core game loop. Authentication and game actions must work first.

**Independent Test**: An overlay client presents a valid read-only world token and retrieves all public world state data. Any write attempt is rejected. Delivers value: visual game state appears in OBS.

**Acceptance Scenarios**:

1. **Given** the overlay has a valid read-only world token, **When** it queries world state endpoints, **Then** it receives current data for that world.
2. **Given** the overlay is authenticated, **When** it attempts any write operation (POST/PUT/DELETE), **Then** the request is rejected with a 403.
3. **Given** the overlay token is scoped to World A, **When** it queries data for World B, **Then** the request is denied.
4. **Given** an overlay request arrives without a token, **When** it reaches the API, **Then** it is rejected with a 401.

---

### User Story 4 - Viewer Participating in a World (Priority: P4)

A viewer watching a stream interacts with the game by redeeming channel points or using other mechanisms. The system needs to identify the viewer (by their Twitch ID) and allow them to read and update their own in-game data (their PlayerWorldData: current character, score, inventory) within the world they are participating in. Viewers cannot touch other viewers' data or any world configuration.

**Why this priority**: Viewer self-service is lower priority than the bot (which acts on their behalf) but important for viewer-facing features like seeing their own stats.

**Independent Test**: A viewer is identified by their Twitch ID, authenticates, and can read and update their own PlayerWorldData for a specific world. Another viewer's data is inaccessible. Delivers value: viewers can see and manage their own game profile.

**Acceptance Scenarios**:

1. **Given** a viewer is authenticated, **When** they request their own PlayerWorldData for a world, **Then** they receive their data.
2. **Given** a viewer is authenticated, **When** they attempt to update another viewer's PlayerWorldData, **Then** the request is denied.
3. **Given** a viewer is authenticated, **When** they attempt to modify world configuration (characters, banners, materials, actions), **Then** the request is denied.
4. **Given** an unauthenticated request arrives claiming to be a viewer, **When** it reaches the API, **Then** it is rejected.

---

### Edge Cases

- What happens when a Twitch account that was previously associated with a Lupworlds user is banned or deauthorized on Twitch? The session must be invalidated and the user must re-authenticate.
- What happens when two requests arrive simultaneously from the same streamer creating their user record for the first time? The system must handle this without creating duplicate accounts.
- What happens if the bot's credential is compromised? There must be a way to revoke it and issue a new one without downtime.
- What happens when a viewer's Twitch session is revoked mid-game? Their in-game session should be invalidated on the next API call.
- What happens when a streamer attempts to issue a read-only overlay token for a world they do not own? The request must be denied.
- How does the system behave when an unknown actor type presents a valid-looking but unrecognized token format? Reject with 401 and log the anomaly.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication**

- **FR-001**: The system MUST allow streamers to authenticate using their Twitch account. The frontend obtains the Twitch access token independently and submits it to the backend, which validates it against the Twitch API to confirm the user's identity.
- **FR-002**: Upon successful Twitch authentication, the system MUST create or update the corresponding user record, associating the Twitch identity with the Lupworlds account.
- **FR-003**: The system MUST issue a session credential to authenticated streamers that is used for all subsequent API requests.
- **FR-004**: The system MUST support issuing pre-shared service credentials to internal services (bot) that are distinct from user-facing credentials.
- **FR-005**: The system MUST support issuing scoped, read-only tokens that allow the OBS overlay to query a specific world's data without write access.
- **FR-006**: The system MUST validate the identity and credential of every API request before executing any operation.
- **FR-007**: Viewer identity MUST be derived from their Twitch ID (provided by the bot or via their own authentication), without requiring a separate full login flow for viewers.

**Authorization & Role Enforcement**

- **FR-008**: The system MUST define and enforce the following roles: **Streamer**, **Viewer**, **Bot**, and **Overlay**.
- **FR-009**: Streamers MUST be permitted to create, read, update, and delete resources (characters, banners, materials, actions, world settings) within their own world only. The streamer's active world is encoded in their token at issuance — no worldId needs to be provided per-request for user callers.
- **FR-010**: Streamers MUST NOT be able to access or modify resources belonging to another streamer's world. Since the token is world-scoped, cross-world access is structurally impossible for user callers.
- **FR-011**: Viewers MUST be permitted to read and update their own PlayerWorldData within a world they participate in.
- **FR-012**: Viewers MUST NOT be permitted to create, update, or delete world configuration resources (characters, banners, materials, actions).
- **FR-013**: The Bot role MUST be permitted to execute game actions (apply materials, trigger actions, update PlayerWorldData) across any world it is configured to operate in.
- **FR-014**: The Bot role MUST NOT be permitted to manage world configuration resources (create/delete characters, banners, etc.).
- **FR-015**: The Overlay role MUST be restricted to read-only operations on world state data for the specific world its token is scoped to.
- **FR-016**: Any request that does not match an authorized role-action combination MUST be rejected with a clear, non-revealing error response.

**Session & Credential Management**

- **FR-017**: Tokens issued after Twitch authentication do NOT expire — they remain valid indefinitely until explicitly revoked. There is no refresh flow.
- **FR-018**: The system MUST provide a mechanism to revoke service credentials (bot) and overlay tokens without requiring a deployment.

**Extensibility**

- **FR-020**: The identity layer MUST be designed so that additional identity providers (beyond Twitch) can be integrated in the future without requiring changes to the authorization logic.

### Key Entities

- **Identity**: Represents a verified external identity (e.g., a Twitch account). Attributes: provider name, provider-specific user ID, display name, last verified timestamp. Links to a Lupworlds User.
- **User**: A Lupworlds account. Attributes: internal ID, associated identities, assigned role, linked world ID (for streamers), creation date.
- **Role**: Defines a category of actor (Streamer, Viewer, Bot, Overlay) and the set of permitted operations associated with it.
- **Session / Credential**: A time-limited or revocable proof of identity presented with each API request. Attributes: issuer, subject (user or service), role, scope (world ID — required for user and overlay tokens; absent for bot), expiry, revocation status. User tokens are scoped to a single world at issuance; switching active worlds requires issuing a new token.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A streamer can complete the full Twitch login flow and arrive at their dashboard in under 30 seconds under normal network conditions.
- **SC-002**: 100% of API endpoints reject unauthenticated requests — no endpoint is accessible without a valid credential.
- **SC-003**: 100% of cross-role authorization attempts (e.g., viewer trying to delete a character, overlay trying to write) are blocked and logged.
- **SC-004**: A streamer can only read and modify resources belonging to their own world — zero cross-world data leakage between streamers.
- **SC-005**: A compromised bot credential can be revoked and replaced without service interruption or requiring a new deployment.
- **SC-006**: Adding a second identity provider in the future requires no changes to the role enforcement or authorization logic — only a new identity adapter.
- **SC-008**: The overlay can retrieve world state data using its scoped token and is denied any write operation 100% of the time.

## Assumptions

- Viewer authentication in this phase relies on Twitch ID passed by the bot or via a lightweight Twitch-based identity check; a full viewer OAuth flow is out of scope for this feature.
- Overlay tokens are issued by authenticated streamers through the dashboard; the mechanism for distributing these tokens to OBS is handled at the dashboard/UI layer, not in this spec.
- The bot is a single trusted internal service for now; multi-bot scenarios with per-bot scoping are a future concern.
- Tokens are non-expiring for simplicity in this phase; token expiry and refresh flows are out of scope and deferred to a future iteration.
- Audit logging of authentication events is out of scope for this phase; deferred until compliance or operational needs arise.
- The current API is a single Lambda proxy — the authorization layer will apply uniformly to all routes handled by that Lambda.
