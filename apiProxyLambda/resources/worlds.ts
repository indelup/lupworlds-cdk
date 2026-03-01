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

const app = new Hono();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.WORLDS_TABLE_NAME;
const bucketName = process.env.WORLD_IMAGES_BUCKET_NAME;
const s3Client = new S3Client({});

app.get("/:id", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

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
app.put("/:id", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    if (!bucketName) {
        return c.json({ error: "Bucket name not configured" }, 500);
    }

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

app.post("/get-presigned-url", async (c) => {
    if (!bucketName) {
        return c.json({ error: "Bucket name not configured" }, 500);
    }

    try {
        const { fileName, contentType } = await c.req.json();
        if (!fileName || !contentType) {
            return c.json({ error: "fileName and contentType are required" }, 400);
        }

        const key = `${randomUUID()}-${fileName}`;

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            ContentType: contentType,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        return c.json({ url, key });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
