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
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing required environment configuration"); return v; };
const tableName = env("USERS_TABLE_NAME");

// Fetch a user from the twitch id — allowed only for self or bot
app.get("/:twitchId", async (c) => {
    const caller = c.get("caller");
    const twitchId = c.req.param("twitchId");

    if (
        caller.type !== "bot" &&
        !(caller.type === "user" && caller.platformId === twitchId)
    ) {
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

// Creates a new User — bot only (user creation handled via /auth/twitch/callback)
app.post("/", async (c) => {
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
