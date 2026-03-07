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
const tableName = process.env.MATERIALS_TABLE_NAME;
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

app.post("/", async (c) => {
    if (!tableName) {
        return c.json({ error: "Table name not configured" }, 500);
    }
    try {
        const body = await c.req.json();
        const newMaterial = {
            ...body,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newMaterial,
        });
        await ddbDocClient.send(command);
        return c.json(newMaterial, 201);
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

    const materialId = c.req.param("id");
    if (!materialId) {
        return c.json({ error: "Material ID is required" }, 400);
    }

    try {
        // Get the existing material to compare images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: materialId },
        });
        const existingMaterial = await ddbDocClient.send(getCommand);

        if (!existingMaterial.Item) {
            return c.json({ error: "Material not found" }, 404);
        }

        const updatedMaterial = await c.req.json();

        // Check if characterSrc or backgroundSrc have changed and delete old ones from S3
        const oldCharacterSrc = existingMaterial.Item.characterSrc;
        const oldBackgroundSrc = existingMaterial.Item.backgroundSrc;
        const newCharacterSrc = updatedMaterial.characterSrc;
        const newBackgroundSrc = updatedMaterial.backgroundSrc;

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

        // Update the material in DynamoDB
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedMaterial,
                id: materialId, // Ensure the ID remains the same
            },
        });

        await ddbDocClient.send(putCommand);

        return c.json({
            message: "Material updated successfully",
            material: {
                ...updatedMaterial,
                id: materialId,
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

    const materialId = c.req.param("id");
    if (!materialId) {
        return c.json({ error: "Material ID is required" }, 400);
    }

    try {
        // Get the existing material to find its images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: materialId },
        });
        const existingMaterial = await ddbDocClient.send(getCommand);

        if (!existingMaterial.Item) {
            return c.json({ error: "Material not found" }, 404);
        }

        // Delete characterSrc from S3 if it exists
        if (existingMaterial.Item.characterSrc) {
            try {
                const deleteCharacterCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingMaterial.Item.characterSrc,
                });
                await s3Client.send(deleteCharacterCommand);
                console.log(
                    `Deleted characterSrc: ${existingMaterial.Item.characterSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete characterSrc ${existingMaterial.Item.characterSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete backgroundSrc from S3 if it exists
        if (existingMaterial.Item.backgroundSrc) {
            try {
                const deleteBackgroundCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingMaterial.Item.backgroundSrc,
                });
                await s3Client.send(deleteBackgroundCommand);
                console.log(
                    `Deleted backgroundSrc: ${existingMaterial.Item.backgroundSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete backgroundSrc ${existingMaterial.Item.backgroundSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete the material from DynamoDB
        const deleteCommand = new DeleteCommand({
            TableName: tableName,
            Key: { id: materialId },
        });

        await ddbDocClient.send(deleteCommand);

        return c.json({
            message: "Material deleted successfully",
            deletedMaterial: existingMaterial.Item,
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
