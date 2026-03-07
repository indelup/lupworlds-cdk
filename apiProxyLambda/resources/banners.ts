import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { AppEnv } from "../types/auth";
import { resolveWorldId, requireNotOverlay, requireItemWorldWrite } from "../middleware/authorization";

const tableName = process.env.BANNERS_TABLE_NAME;
if (!tableName) throw new Error("BANNERS_TABLE_NAME not set");

const bucketName = process.env.BANNER_IMAGES_BUCKET_NAME;
if (!bucketName) throw new Error("BANNER_IMAGES_BUCKET_NAME not set");

const app = new Hono<AppEnv>();
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

app.get("/", async (c) => {
    const worldId = c.req.query("worldId");
    if (!worldId) return c.json({ error: "worldId parameter is required" }, 400);

    try {
        const response = await ddbDocClient.send(
            new QueryCommand({
                TableName: tableName,
                IndexName: "WorldIdIndex",
                KeyConditionExpression: "worldId = :worldId",
                ExpressionAttributeValues: { ":worldId": worldId },
            }),
        );
        return c.json(response.Items);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.post("/", resolveWorldId, async (c) => {
    try {
        const worldId = c.get("worldId");
        const body = c.get("parsedBody");
        const newBanner = { ...body, worldId, id: randomUUID(), createdAt: new Date().toISOString() };
        await ddbDocClient.send(new PutCommand({ TableName: tableName, Item: newBanner }));
        return c.json(newBanner, 201);
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

app.put("/:id", requireItemWorldWrite(tableName), async (c) => {
    const bannerId = c.req.param("id");
    const existing = c.get("existingItem");
    try {
        const updatedBanner = await c.req.json();

        if (existing.imageSrc && existing.imageSrc !== updatedBanner.imageSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.imageSrc as string }),
                );
                console.log(`Deleted old imageSrc: ${existing.imageSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete imageSrc ${existing.imageSrc}:`, deleteError);
            }
        }

        await ddbDocClient.send(
            new PutCommand({ TableName: tableName, Item: { ...updatedBanner, id: bannerId } }),
        );
        return c.json({ message: "Banner updated successfully", banner: { ...updatedBanner, id: bannerId } });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.delete("/:id", requireItemWorldWrite(tableName), async (c) => {
    const bannerId = c.req.param("id");
    const existing = c.get("existingItem");
    try {
        if (existing.imageSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.imageSrc as string }),
                );
                console.log(`Deleted imageSrc: ${existing.imageSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete imageSrc ${existing.imageSrc}:`, deleteError);
            }
        }

        await ddbDocClient.send(new DeleteCommand({ TableName: tableName, Key: { id: bannerId } }));
        return c.json({ message: "Banner deleted successfully", deletedBanner: existing });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
