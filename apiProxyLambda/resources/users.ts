import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    QueryCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import type { AppEnv } from "../types/auth";
import { requireNotOverlay } from "../middleware/authorization";

const tableName = process.env.USERS_TABLE_NAME;
if (!tableName) throw new Error("USERS_TABLE_NAME not set");

const app = new Hono<AppEnv>();
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Fetch a user by twitchId.
// User callers can only access their own record (platformId === twitchId).
// Bot callers can access any record.
app.get("/:twitchId", requireNotOverlay, async (c) => {
    const twitchId = c.req.param("twitchId");
    const caller = c.get("caller");

    if (caller.type === "user" && caller.platformId !== twitchId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const response = await ddbDocClient.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: "TwitchIdIndex",
                KeyConditionExpression: "twitchId = :twitchId",
                ExpressionAttributeValues: { ":twitchId": twitchId },
                Limit: 1,
            }),
        );
        if (!response.Items || response.Items.length === 0) {
            return c.json({ error: "User not found" }, 404);
        }
        return c.json(response.Items[0]);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

// Creates a new User — bot only.
// User creation for streamers/viewers happens via GET /auth/twitch/callback.
app.post("/", async (c) => {
    if (c.get("caller").type !== "bot") return c.json({ error: "Forbidden" }, 403);
    try {
        const body = await c.req.json();
        const newUser = { id: randomUUID(), ...body };
        await ddbDocClient.send(new PutCommand({ TableName: tableName, Item: newUser }));
        return c.json(newUser, 201);
    } catch (error) {
        console.error(error);
        return c.json({ error: "Could not create user" }, 500);
    }
});

export default app;
