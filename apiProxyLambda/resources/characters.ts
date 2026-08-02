import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    GetCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { resolveWorldId, requireItemWorldWrite } from "../middleware/authorization";
import type { AppEnv } from "../types/auth";


const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing required environment configuration"); return v; };
const tableName = env("CHARACTERS_TABLE_NAME");
const bucketName = env("ASSET_IMAGES_BUCKET_NAME");
const s3Client = new S3Client({});

app.get("/", async (c) => {
    const worldId = c.req.query("worldId");

    if (!worldId) {
        return c.json({ error: "worldId parameter is required" }, 400);
    }

    try {
        const command = new QueryCommand({
            TableName: tableName,
            IndexName: "WorldIdIndex", // You'll need to create this GSI
            KeyConditionExpression: "worldId = :worldId",
            ExpressionAttributeValues: {
                ":worldId": worldId,
            },
        });
        const response = await ddbDocClient.send(command);
        return c.json(response.Items);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.post("/", resolveWorldId, async (c) => {
    try {
        const worldId = c.get("worldId");
        const body = await c.req.json();
        const newCharacter = {
            ...body,
            worldId,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newCharacter,
        });
        await ddbDocClient.send(command);
        return c.json(newCharacter, 201);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.put("/:id", requireItemWorldWrite(tableName, "id"), async (c) => {
    const characterId = c.req.param("id");
    const existingCharacter = { Item: c.get("existingItem") as any };

    try {
        const updatedCharacter = await c.req.json();

        // Check if characterSrc or backgroundSrc have changed and delete old ones from S3
        const oldCharacterSrc = existingCharacter.Item.characterSrc;
        const oldBackgroundSrc = existingCharacter.Item.backgroundSrc;
        const newCharacterSrc = updatedCharacter.characterSrc;
        const newBackgroundSrc = updatedCharacter.backgroundSrc;

        // Delete old characterSrc if it changed and is not empty
        if (oldCharacterSrc && oldCharacterSrc !== newCharacterSrc) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: oldCharacterSrc,
                });
                await s3Client.send(deleteCommand);
                console.log(`Deleted old characterSrc: ${oldCharacterSrc}`);
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete characterSrc ${oldCharacterSrc}:`,
                    deleteError,
                );
                // Continue with the update even if image deletion fails
            }
        }

        // Delete old backgroundSrc if it changed and is not empty
        if (oldBackgroundSrc && oldBackgroundSrc !== newBackgroundSrc) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: oldBackgroundSrc,
                });
                await s3Client.send(deleteCommand);
                console.log(`Deleted old backgroundSrc: ${oldBackgroundSrc}`);
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete backgroundSrc ${oldBackgroundSrc}:`,
                    deleteError,
                );
                // Continue with the update even if image deletion fails
            }
        }

        // Update the character in DynamoDB
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedCharacter,
                id: characterId, // Ensure the ID remains the same
            },
        });

        await ddbDocClient.send(putCommand);

        return c.json({
            message: "Character updated successfully",
            character: {
                ...updatedCharacter,
                id: characterId,
            },
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.delete("/:id", requireItemWorldWrite(tableName, "id"), async (c) => {
    const characterId = c.req.param("id");
    const existingCharacter = { Item: c.get("existingItem") as any };

    try {

        // Delete characterSrc from S3 if it exists
        if (existingCharacter.Item.characterSrc) {
            try {
                const deleteCharacterCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingCharacter.Item.characterSrc,
                });
                await s3Client.send(deleteCharacterCommand);
                console.log(
                    `Deleted characterSrc: ${existingCharacter.Item.characterSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete characterSrc ${existingCharacter.Item.characterSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete backgroundSrc from S3 if it exists
        if (existingCharacter.Item.backgroundSrc) {
            try {
                const deleteBackgroundCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingCharacter.Item.backgroundSrc,
                });
                await s3Client.send(deleteBackgroundCommand);
                console.log(
                    `Deleted backgroundSrc: ${existingCharacter.Item.backgroundSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete backgroundSrc ${existingCharacter.Item.backgroundSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete the character from DynamoDB
        const deleteCommand = new DeleteCommand({
            TableName: tableName,
            Key: { id: characterId },
        });

        await ddbDocClient.send(deleteCommand);

        return c.json({
            message: "Character deleted successfully",
            deletedCharacter: existingCharacter.Item,
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
