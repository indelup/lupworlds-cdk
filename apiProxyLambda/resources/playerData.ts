import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireSelfDataWrite } from "../middleware/authorization";
import type { AppEnv } from "../types/auth";

const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.PLAYER_WORLD_DATA_TABLE_NAME;

// GET /player-data/:userId/:worldId
// Returns PlayerWorldData for a viewer in a world, or an empty default if not found.
app.get("/:userId/:worldId", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

    const userId = c.req.param("userId");
    const worldId = c.req.param("worldId");

    try {
        const command = new GetCommand({
            TableName: tableName,
            Key: { userId, worldId },
        });
        const response = await ddbDocClient.send(command);

        if (!response.Item) {
            return c.json({ userId, worldId, characters: [], materials: [] });
        }

        return c.json(response.Item);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

// PUT /player-data/:userId/:worldId
// Upserts the full PlayerWorldData for a viewer in a world.
app.put("/:userId/:worldId", requireSelfDataWrite("userId"), async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

    const userId = c.req.param("userId");
    const worldId = c.req.param("worldId");

    try {
        const body = await c.req.json();
        const item = { ...body, userId, worldId };

        const command = new PutCommand({
            TableName: tableName,
            Item: item,
        });
        await ddbDocClient.send(command);

        return c.json(item);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
