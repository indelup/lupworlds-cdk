import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    GetCommand,
    DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { AppEnv, CallerContext } from "../types/auth";

const app = new Hono<AppEnv>();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.BANNERS_TABLE_NAME;
const bucketName = process.env.BANNER_IMAGES_BUCKET_NAME;
const s3Client = new S3Client({});

function canWrite(caller: CallerContext, worldId: string | undefined): boolean {
    if (caller.type === "bot") return true;
    if (
        caller.type === "user" &&
        worldId &&
        caller.ownedWorldIds.includes(worldId)
    )
        return true;
    return false;
}

app.get("/", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }

    const worldId = c.req.query("worldId");

    if (!worldId) {
        return c.json({ error: "worldId parameter is required" }, 400);
    }

    try {
        const command = new QueryCommand({
            TableName: tableName,
            IndexName: "WorldIdIndex",
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

app.post("/", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    try {
        const body = await c.req.json();
        const caller = c.get("caller");

        if (!canWrite(caller, body.worldId)) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const newBanner = {
            ...body,
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

app.post("/get-presigned-url", async (c) => {
    if (!bucketName) {
        return c.json({ error: "Bucket name not configured" }, 500);
    }
    const caller = c.get("caller");
    if (caller.type === "overlay") {
        return c.json({ error: "Forbidden" }, 403);
    }
    try {
        const { fileName, contentType } = await c.req.json();
        if (!fileName || !contentType) {
            return c.json(
                { error: "fileName and contentType are required" },
                400,
            );
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

app.put("/:id", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    if (!bucketName) {
        return c.json({ error: "Bucket name not configured" }, 500);
    }

    const bannerId = c.req.param("id");
    if (!bannerId) {
        return c.json({ error: "Banner ID is required" }, 400);
    }

    try {
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: bannerId },
        });
        const existingBanner = await ddbDocClient.send(getCommand);

        if (!existingBanner.Item) {
            return c.json({ error: "Banner not found" }, 404);
        }

        const caller = c.get("caller");
        if (!canWrite(caller, existingBanner.Item.worldId as string)) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const updatedBanner = await c.req.json();

        const oldImageSrc = existingBanner.Item.imageSrc;
        const newImageSrc = updatedBanner.imageSrc;

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
            }
        }

        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedBanner,
                id: bannerId,
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

app.delete("/:id", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    if (!bucketName) {
        return c.json({ error: "Bucket name not configured" }, 500);
    }

    const bannerId = c.req.param("id");
    if (!bannerId) {
        return c.json({ error: "Banner ID is required" }, 400);
    }

    try {
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: bannerId },
        });
        const existingBanner = await ddbDocClient.send(getCommand);

        if (!existingBanner.Item) {
            return c.json({ error: "Banner not found" }, 404);
        }

        const caller = c.get("caller");
        if (!canWrite(caller, existingBanner.Item.worldId as string)) {
            return c.json({ error: "Forbidden" }, 403);
        }

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
            }
        }

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
