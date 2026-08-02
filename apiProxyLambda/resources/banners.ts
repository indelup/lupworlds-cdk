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
const tableName = env("BANNERS_TABLE_NAME");
const bucketName = env("CONFIG_IMAGES_BUCKET_NAME");
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
        const newBanner = {
            ...body,
            worldId,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newBanner,
        });
        await ddbDocClient.send(command);
        return c.json(newBanner, 201);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.put("/:id", requireItemWorldWrite(tableName, "id"), async (c) => {
    const bannerId = c.req.param("id");
    const existingBanner = { Item: c.get("existingItem") as any };

    try {
        const updatedBanner = await c.req.json();

        // Check if imageSrc has changed and delete old one from S3
        const oldImageSrc = existingBanner.Item.imageSrc;
        const newImageSrc = updatedBanner.imageSrc;

        // Delete old imageSrc if it changed and is not empty
        if (oldImageSrc && oldImageSrc !== newImageSrc) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: oldImageSrc,
                });
                await s3Client.send(deleteCommand);
                console.log(`Deleted old imageSrc: ${oldImageSrc}`);
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete imageSrc ${oldImageSrc}:`,
                    deleteError,
                );
                // Continue with the update even if image deletion fails
            }
        }

        // Update the banner in DynamoDB
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedBanner,
                id: bannerId, // Ensure the ID remains the same
            },
        });

        await ddbDocClient.send(putCommand);

        return c.json({
            message: "Banner updated successfully",
            banner: {
                ...updatedBanner,
                id: bannerId,
            },
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.delete("/:id", requireItemWorldWrite(tableName, "id"), async (c) => {
    const bannerId = c.req.param("id");
    const existingBanner = { Item: c.get("existingItem") as any };

    try {

        // Delete imageSrc from S3 if it exists
        if (existingBanner.Item.imageSrc) {
            try {
                const deleteImageCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingBanner.Item.imageSrc,
                });
                await s3Client.send(deleteImageCommand);
                console.log(
                    `Deleted imageSrc: ${existingBanner.Item.imageSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete imageSrc ${existingBanner.Item.imageSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete the banner from DynamoDB
        const deleteCommand = new DeleteCommand({
            TableName: tableName,
            Key: { id: bannerId },
        });

        await ddbDocClient.send(deleteCommand);

        return c.json({
            message: "Banner deleted successfully",
            deletedBanner: existingBanner.Item,
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
