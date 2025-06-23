import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

const app = new Hono();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.USERS_TABLE_NAME;

// Fetch a user from the twitch id
app.get("/:twitchId", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    const twitchId = c.req.param("twitchId");
    try {
        const command = new ScanCommand({
            TableName: tableName,
            FilterExpression: "twitchId = :twitchId",
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

// Creates a new User
// TODO: This should validate that the user is correctly logged in with twitch in the frontend
app.post("/", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
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
