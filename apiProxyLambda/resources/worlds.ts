import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { requireWorldWrite } from "../middleware/authorization";
import type { AppEnv } from "../types/auth";


const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error("Missing required environment configuration"); return v; };
const tableName = env("WORLDS_TABLE_NAME");
const bucketName = env("CONFIG_IMAGES_BUCKET_NAME");
const s3Client = new S3Client({});

app.get("/:id", async (c) => {
    const worldId = c.req.param("id");

    try {
        const command = new GetCommand({
            TableName: tableName,
            Key: { id: worldId },
        });
        const response = await ddbDocClient.send(command);

        if (!response.Item) {
            return c.json({ error: "World not found" }, 404);
        }

        return c.json(response.Item);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

// Upsert — creates or updates a world
app.put("/:id", requireWorldWrite("id"), async (c) => {
    const worldId = c.req.param("id");

    try {
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: worldId },
        });
        const existing = await ddbDocClient.send(getCommand);

        const updatedWorld = await c.req.json();

        // Clean up replaced images only when updating an existing world
        if (existing.Item) {
            const oldLogoSrc = existing.Item.logoSrc;
            const oldBackgroundSrc = existing.Item.backgroundSrc;

            if (oldLogoSrc && oldLogoSrc !== updatedWorld.logoSrc) {
                try {
                    await s3Client.send(
                        new DeleteObjectCommand({ Bucket: bucketName, Key: oldLogoSrc }),
                    );
                } catch (deleteError: any) {
                    console.error(`Failed to delete old logoSrc ${oldLogoSrc}:`, deleteError);
                }
            }

            if (oldBackgroundSrc && oldBackgroundSrc !== updatedWorld.backgroundSrc) {
                try {
                    await s3Client.send(
                        new DeleteObjectCommand({ Bucket: bucketName, Key: oldBackgroundSrc }),
                    );
                } catch (deleteError: any) {
                    console.error(`Failed to delete old backgroundSrc ${oldBackgroundSrc}:`, deleteError);
                }
            }

            for (const rarity of [1, 2, 3, 4, 5]) {
                const oldKey = existing.Item.cardBacks?.[rarity];
                const newKey = updatedWorld.cardBacks?.[rarity];
                if (oldKey && oldKey !== newKey) {
                    try {
                        await s3Client.send(
                            new DeleteObjectCommand({ Bucket: bucketName, Key: oldKey }),
                        );
                    } catch (deleteError: any) {
                        console.error(`Failed to delete old cardBacks[${rarity}] ${oldKey}:`, deleteError);
                    }
                }
            }

            // Clean up replaced or deleted currency images
            const oldCurrencies: { id: string; image: string }[] = existing.Item.currencies ?? [];
            const newCurrencyIds = new Set((updatedWorld.currencies ?? []).map((c: any) => c.id));
            const newCurrencyImageMap = new Map(
                (updatedWorld.currencies ?? []).map((c: any) => [c.id, c.image]),
            );
            for (const oldCurrency of oldCurrencies) {
                const stillExists = newCurrencyIds.has(oldCurrency.id);
                const imageChanged = newCurrencyImageMap.get(oldCurrency.id) !== oldCurrency.image;
                if (oldCurrency.image && (!stillExists || imageChanged)) {
                    try {
                        await s3Client.send(
                            new DeleteObjectCommand({ Bucket: bucketName, Key: oldCurrency.image }),
                        );
                    } catch (deleteError: any) {
                        console.error(`Failed to delete currency image ${oldCurrency.image}:`, deleteError);
                    }
                }
            }
        }

        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedWorld,
                id: worldId,
            },
        });
        await ddbDocClient.send(putCommand);

        return c.json({ ...updatedWorld, id: worldId });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
