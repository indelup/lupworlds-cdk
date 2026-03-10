import { Hono } from "hono";
import { sign } from "hono/jwt";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { getJwtSecret, getTwitchClientSecret } from "../lib/secrets";
import type { AppEnv, AccessTokenPayload, OverlayTokenPayload, TwitchUserInfo } from "../types/auth";

const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);


const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing required environment configuration"); return v; };
const usersTableName = env("USERS_TABLE_NAME");
const twitchClientId = env("TWITCH_CLIENT_ID");
const twitchRedirectUri = env("TWITCH_REDIRECT_URI");
const frontendUrl = env("FRONTEND_URL");

// GET /auth/twitch/callback — public, skipped by auth middleware
app.get("/twitch/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) {
        return c.json({ error: "Missing code parameter" }, 400);
    }

    try {
        const clientSecret = await getTwitchClientSecret();

        // Exchange code for Twitch access token
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: twitchClientId,
                client_secret: clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: twitchRedirectUri,
            }),
        });

        if (!tokenRes.ok) {
            return c.json({ error: "Twitch token exchange failed" }, 502);
        }

        const { access_token: twitchAccessToken } = (await tokenRes.json()) as {
            access_token: string;
        };

        // Fetch Twitch user info
        const userRes = await fetch("https://api.twitch.tv/helix/users", {
            headers: {
                Authorization: `Bearer ${twitchAccessToken}`,
                "Client-Id": twitchClientId,
            },
        });

        if (!userRes.ok) {
            return c.json({ error: "Failed to fetch Twitch user info" }, 502);
        }

        const { data } = (await userRes.json()) as { data: TwitchUserInfo[] };
        const twitchUser = data[0];
        if (!twitchUser) {
            return c.json({ error: "No Twitch user data returned" }, 502);
        }

        // Find or create Lupworlds user
        const queryResult = await ddbDocClient.send(
            new QueryCommand({
                TableName: usersTableName,
                IndexName: "TwitchIdIndex",
                KeyConditionExpression: "twitchId = :twitchId",
                ExpressionAttributeValues: { ":twitchId": twitchUser.id },
                Limit: 1,
            }),
        );

        let user = queryResult.Items?.[0];
        if (!user) {
            user = {
                id: randomUUID(),
                twitchId: twitchUser.id,
                displayName: twitchUser.display_name,
                allowedRoles: ["viewer"],
                ownedWorldIds: [],
                createdAt: new Date().toISOString(),
            };
            await ddbDocClient.send(
                new PutCommand({ TableName: usersTableName, Item: user }),
            );
        }

        const jwtSecret = await getJwtSecret();
        const payload: AccessTokenPayload = {
            iss: "lupworlds",
            aud: "api",
            typ: "access",
            sub: user.id as string,
            iat: Math.floor(Date.now() / 1000),
            platform: "twitch",
            platformId: twitchUser.id,
            roles: user.allowedRoles as AccessTokenPayload["roles"],
            ownedWorldIds: (user.ownedWorldIds as string[]) ?? [],
            worldId: ((user.ownedWorldIds as string[]) ?? [])[0] ?? "",
        };

        const jwt = await sign(payload as unknown as Record<string, unknown>, jwtSecret);
        return c.redirect(`${frontendUrl}?token=${jwt}`);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

// POST /auth/overlay-token — protected, streamer only
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

    if (!body.worldId) {
        return c.json({ error: "worldId is required" }, 400);
    }

    if (caller.worldId !== body.worldId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const jwtSecret = await getJwtSecret();
    const payload: OverlayTokenPayload = {
        iss: "lupworlds",
        aud: "overlay",
        typ: "overlay",
        wid: caller.worldId,
        scopes: ["world:read", "playerdata:read"],
        iat: Math.floor(Date.now() / 1000),
    };

    const token = await sign(payload as unknown as Record<string, unknown>, jwtSecret);
    return c.json({ token });
});

export default app;
