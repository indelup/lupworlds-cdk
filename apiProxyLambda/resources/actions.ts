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
const tableName = process.env.ACTIONS_TABLE_NAME;
const bucketName = process.env.ACTION_IMAGES_BUCKET_NAME;
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

        const newAction = {
            ...body,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newAction,
        });
        await ddbDocClient.send(command);
        return c.json(newAction, 201);
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

    const actionId = c.req.param("id");
    if (!actionId) {
        return c.json({ error: "Action ID is required" }, 400);
    }

    try {
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: actionId },
        });
        const existingAction = await ddbDocClient.send(getCommand);

        if (!existingAction.Item) {
            return c.json({ error: "Action not found" }, 404);
        }

        const caller = c.get("caller");
        if (!canWrite(caller, existingAction.Item.worldId as string)) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const updatedAction = await c.req.json();

        const oldActionSrc = existingAction.Item.actionSrc;
        const oldBackgroundSrc = existingAction.Item.backgroundSrc;
        const newActionSrc = updatedAction.actionSrc;
        const newBackgroundSrc = updatedAction.backgroundSrc;

        if (oldActionSrc && oldActionSrc !== newActionSrc) {
            try {
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: oldActionSrc,
                });
                await s3Client.send(deleteCommand);
                console.log(`Deleted old actionSrc: ${oldActionSrc}`);
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete actionSrc ${oldActionSrc}:`,
                    deleteError,
                );
            }
        }

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
            }
        }

        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedAction,
                id: actionId,
            },
        });

        await ddbDocClient.send(putCommand);

        return c.json({
            message: "Action updated successfully",
            action: {
                ...updatedAction,
                id: actionId,
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

    const actionId = c.req.param("id");
    if (!actionId) {
        return c.json({ error: "Action ID is required" }, 400);
    }

    try {
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: actionId },
        });
        const existingAction = await ddbDocClient.send(getCommand);

        if (!existingAction.Item) {
            return c.json({ error: "Action not found" }, 404);
        }

        const caller = c.get("caller");
        if (!canWrite(caller, existingAction.Item.worldId as string)) {
            return c.json({ error: "Forbidden" }, 403);
        }

        if (existingAction.Item.actionSrc) {
            try {
                const deleteActionCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingAction.Item.actionSrc,
                });
                await s3Client.send(deleteActionCommand);
                console.log(
                    `Deleted actionSrc: ${existingAction.Item.actionSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete actionSrc ${existingAction.Item.actionSrc}:`,
                    deleteError,
                );
            }
        }

        if (existingAction.Item.backgroundSrc) {
            try {
                const deleteBackgroundCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingAction.Item.backgroundSrc,
                });
                await s3Client.send(deleteBackgroundCommand);
                console.log(
                    `Deleted backgroundSrc: ${existingAction.Item.backgroundSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete backgroundSrc ${existingAction.Item.backgroundSrc}:`,
                    deleteError,
                );
            }
        }

        const deleteCommand = new DeleteCommand({
            TableName: tableName,
            Key: { id: actionId },
        });

        await ddbDocClient.send(deleteCommand);

        return c.json({
            message: "Action deleted successfully",
            deletedAction: existingAction.Item,
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
