import { Hono } from "hono";
import { sign } from "hono/jwt";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    QueryCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import type { AppEnv, AccessTokenPayload, OverlayTokenPayload } from "../types/auth";
import { getJwtSecret, getTwitchClientSecret } from "../lib/secrets";

const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);

// GET /auth/twitch/callback — public (auth middleware skips this route)
app.get("/twitch/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
        return c.json({ error: "Missing code parameter" }, 400);
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const redirectUri = process.env.TWITCH_REDIRECT_URI;
    const frontendUrl = process.env.FRONTEND_URL;
    const usersTable = process.env.USERS_TABLE_NAME;

    if (!clientId || !redirectUri || !frontendUrl || !usersTable) {
        return c.json({ error: "Server misconfiguration" }, 500);
    }

    try {
        const [clientSecret, jwtSecret] = await Promise.all([
            getTwitchClientSecret(),
            getJwtSecret(),
        ]);

        // Exchange code for Twitch access token
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenRes.ok) {
            console.error(
                "Twitch token exchange failed:",
                await tokenRes.text(),
            );
            return c.json({ error: "Twitch authentication failed" }, 502);
        }

        const tokenData = (await tokenRes.json()) as { access_token: string };

        // Fetch Twitch user info
        const userRes = await fetch("https://api.twitch.tv/helix/users", {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Client-Id": clientId,
            },
        });

        if (!userRes.ok) {
            console.error("Twitch user fetch failed:", await userRes.text());
            return c.json({ error: "Failed to fetch Twitch user" }, 502);
        }

        const userData = (await userRes.json()) as {
            data: Array<{ id: string; display_name: string }>;
        };
        const twitchUser = userData.data[0];

        if (!twitchUser) {
            return c.json({ error: "No Twitch user data returned" }, 502);
        }

        // Find or create Lupworlds user
        const queryRes = await ddbDocClient.send(
            new QueryCommand({
                TableName: usersTable,
                IndexName: "TwitchIdIndex",
                KeyConditionExpression: "twitchId = :twitchId",
                ExpressionAttributeValues: { ":twitchId": twitchUser.id },
                Limit: 1,
            }),
        );

        type UserRecord = {
            id: string;
            twitchId: string;
            displayName: string;
            allowedRoles: string[];
            ownedWorldIds: string[];
            createdAt: string;
        };

        let user: UserRecord;

        if (queryRes.Items && queryRes.Items.length > 0) {
            user = queryRes.Items[0] as UserRecord;
            // Keep displayName up to date
            if (user.displayName !== twitchUser.display_name) {
                user = { ...user, displayName: twitchUser.display_name };
                await ddbDocClient.send(
                    new PutCommand({ TableName: usersTable, Item: user }),
                );
            }
        } else {
            user = {
                id: randomUUID(),
                twitchId: twitchUser.id,
                displayName: twitchUser.display_name,
                allowedRoles: ["viewer"],
                ownedWorldIds: [],
                createdAt: new Date().toISOString(),
            };
            await ddbDocClient.send(
                new PutCommand({ TableName: usersTable, Item: user }),
            );
        }

        // Issue Lupworlds JWT
        const payload: AccessTokenPayload = {
            iss: "lupworlds",
            aud: "api",
            typ: "access",
            sub: user.id,
            iat: Math.floor(Date.now() / 1000),
            platform: "twitch",
            platformId: user.twitchId,
            roles: user.allowedRoles as AccessTokenPayload["roles"],
            ownedWorldIds: user.ownedWorldIds,
        };

        const jwt = await sign(payload as unknown as Record<string, unknown>, jwtSecret);

        return c.redirect(`${frontendUrl}?token=${jwt}`, 302);
    } catch (error: any) {
        console.error("Auth callback error:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});

// POST /auth/overlay-token — streamer only (protected by auth middleware)
app.post("/overlay-token", async (c) => {
    const caller = c.get("caller");

    if (caller.type !== "user") {
        return c.json({ error: "Forbidden" }, 403);
    }

    let body: { worldId?: string };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const worldId = body.worldId;
    if (!worldId) {
        return c.json({ error: "worldId is required" }, 400);
    }

    if (!caller.ownedWorldIds.includes(worldId)) {
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const jwtSecret = await getJwtSecret();

        const payload: OverlayTokenPayload = {
            iss: "lupworlds",
            aud: "overlay",
            typ: "overlay",
            wid: worldId,
            scopes: ["world:read", "playerdata:read"],
            iat: Math.floor(Date.now() / 1000),
        };

        const token = await sign(payload as unknown as Record<string, unknown>, jwtSecret);
        return c.json({ token });
    } catch (error: any) {
        console.error("Overlay token error:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});

export default app;
