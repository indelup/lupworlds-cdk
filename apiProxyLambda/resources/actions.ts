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

const tableName = process.env.ACTIONS_TABLE_NAME;
if (!tableName) throw new Error("ACTIONS_TABLE_NAME not set");

const bucketName = process.env.ACTION_IMAGES_BUCKET_NAME;
if (!bucketName) throw new Error("ACTION_IMAGES_BUCKET_NAME not set");

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
        const newAction = { ...body, worldId, id: randomUUID(), createdAt: new Date().toISOString() };
        await ddbDocClient.send(new PutCommand({ TableName: tableName, Item: newAction }));
        return c.json(newAction, 201);
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
    const actionId = c.req.param("id");
    const existing = c.get("existingItem");
    try {
        const updatedAction = await c.req.json();

        if (existing.actionSrc && existing.actionSrc !== updatedAction.actionSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.actionSrc as string }),
                );
                console.log(`Deleted old actionSrc: ${existing.actionSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete actionSrc ${existing.actionSrc}:`, deleteError);
            }
        }

        if (existing.backgroundSrc && existing.backgroundSrc !== updatedAction.backgroundSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.backgroundSrc as string }),
                );
                console.log(`Deleted old backgroundSrc: ${existing.backgroundSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete backgroundSrc ${existing.backgroundSrc}:`, deleteError);
            }
        }

        await ddbDocClient.send(
            new PutCommand({ TableName: tableName, Item: { ...updatedAction, id: actionId } }),
        );
        return c.json({ message: "Action updated successfully", action: { ...updatedAction, id: actionId } });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

app.delete("/:id", requireItemWorldWrite(tableName), async (c) => {
    const actionId = c.req.param("id");
    const existing = c.get("existingItem");
    try {
        if (existing.actionSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.actionSrc as string }),
                );
                console.log(`Deleted actionSrc: ${existing.actionSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete actionSrc ${existing.actionSrc}:`, deleteError);
            }
        }

        if (existing.backgroundSrc) {
            try {
                await s3Client.send(
                    new DeleteObjectCommand({ Bucket: bucketName, Key: existing.backgroundSrc as string }),
                );
                console.log(`Deleted backgroundSrc: ${existing.backgroundSrc}`);
            } catch (deleteError: any) {
                console.error(`Failed to delete backgroundSrc ${existing.backgroundSrc}:`, deleteError);
            }
        }

        await ddbDocClient.send(new DeleteCommand({ TableName: tableName, Key: { id: actionId } }));
        return c.json({ message: "Action deleted successfully", deletedAction: existing });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
