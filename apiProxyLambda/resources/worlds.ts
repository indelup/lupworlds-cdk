import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { AppEnv } from "../types/auth";
import { requireNotOverlay, requireWorldWrite } from "../middleware/authorization";

const tableName = process.env.WORLDS_TABLE_NAME;
if (!tableName) throw new Error("WORLDS_TABLE_NAME not set");

const bucketName = process.env.WORLD_IMAGES_BUCKET_NAME;
if (!bucketName) throw new Error("WORLD_IMAGES_BUCKET_NAME not set");

const app = new Hono<AppEnv>();
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

app.get("/:id", async (c) => {
    const worldId = c.req.param("id");
    try {
        const response = await ddbDocClient.send(
            new GetCommand({ TableName: tableName, Key: { id: worldId } }),
        );
        if (!response.Item) return c.json({ error: "World not found" }, 404);
        return c.json(response.Item);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

// Upsert — creates or updates a world
app.put("/:id", requireWorldWrite(), async (c) => {
    const worldId = c.req.param("id");
    try {
        const existing = await ddbDocClient.send(
            new GetCommand({ TableName: tableName, Key: { id: worldId } }),
        );
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
        }

        await ddbDocClient.send(
            new PutCommand({ TableName: tableName, Item: { ...updatedWorld, id: worldId } }),
        );
        return c.json({ ...updatedWorld, id: worldId });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.post("/get-presigned-url", requireNotOverlay, async (c) => {
    try {
        const { fileName, contentType } = await c.req.json();
        if (!fileName || !contentType) {
            return c.json({ error: "fileName and contentType are required" }, 400);
        }
        const key = `${randomUUID()}-${fileName}`;
        const url = await getSignedUrl(
            s3Client,
            new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType }),
            { expiresIn: 3600 },
        );
        return c.json({ url, key });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
