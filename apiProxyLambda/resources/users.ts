import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    QueryCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import type { AppEnv } from "../types/auth";

const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.USERS_TABLE_NAME;

// Fetch a user by twitchId.
// User callers can only access their own record (platformId === twitchId).
// Bot callers can access any record.
app.get("/:twitchId", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

    const twitchId = c.req.param("twitchId");
    const caller = c.get("caller");

    if (caller.type === "overlay") {
        return c.json({ error: "Forbidden" }, 403);
    }

    if (caller.type === "user" && caller.platformId !== twitchId) {
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const command = new QueryCommand({
            TableName: tableName,
            IndexName: "TwitchIdIndex",
            KeyConditionExpression: "twitchId = :twitchId",
            ExpressionAttributeValues: {
                ":twitchId": twitchId,
            },
            Limit: 1,
        });
        const response = await ddbDocClient.send(command);
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
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

    const caller = c.get("caller");
    if (caller.type !== "bot") {
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const body = await c.req.json();
        const newUser = {
            id: randomUUID(),
            ...body,
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newUser,
        });
        await ddbDocClient.send(command);
        return c.json(newUser, 201);
    } catch (error) {
        console.error(error);
        return c.json({ error: "Could not create user" }, 500);
    }
});

export default app;
