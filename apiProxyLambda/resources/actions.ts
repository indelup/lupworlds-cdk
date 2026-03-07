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

const app = new Hono();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.ACTIONS_TABLE_NAME;
const bucketName = process.env.ASSET_IMAGES_BUCKET_NAME;
const s3Client = new S3Client({});

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
        // Get the existing action to compare images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: actionId },
        });
        const existingAction = await ddbDocClient.send(getCommand);

        if (!existingAction.Item) {
            return c.json({ error: "Action not found" }, 404);
        }

        const updatedAction = await c.req.json();

        // Check if actionSrc or backgroundSrc have changed and delete old ones from S3
        const oldActionSrc = existingAction.Item.actionSrc;
        const oldBackgroundSrc = existingAction.Item.backgroundSrc;
        const newActionSrc = updatedAction.actionSrc;
        const newBackgroundSrc = updatedAction.backgroundSrc;

        // Delete old actionSrc if it changed and is not empty
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

        // Update the action in DynamoDB
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedAction,
                id: actionId, // Ensure the ID remains the same
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
        // Get the existing action to find its images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: actionId },
        });
        const existingAction = await ddbDocClient.send(getCommand);

        if (!existingAction.Item) {
            return c.json({ error: "Action not found" }, 404);
        }

        // Delete actionSrc from S3 if it exists
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
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete backgroundSrc from S3 if it exists
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
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete the action from DynamoDB
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
