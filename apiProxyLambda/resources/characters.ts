import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
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

const app = new Hono();

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);
const tableName = process.env.CHARACTERS_TABLE_NAME;
const bucketName = process.env.CHARACTER_IMAGES_BUCKET_NAME;
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
        const newCharacter = {
            ...body,
            id: randomUUID(),
        };
        const command = new PutCommand({
            TableName: tableName,
            Item: newCharacter,
        });
        await ddbDocClient.send(command);
        return c.json(newCharacter, 201);
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

    const characterId = c.req.param("id");
    if (!characterId) {
        return c.json({ error: "Character ID is required" }, 400);
    }

    try {
        // Get the existing character to compare images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: characterId },
        });
        const existingCharacter = await ddbDocClient.send(getCommand);

        if (!existingCharacter.Item) {
            return c.json({ error: "Character not found" }, 404);
        }

        const updatedCharacter = await c.req.json();

        // Check if characterSrc or backgroundSrc have changed and delete old ones from S3
        const oldCharacterSrc = existingCharacter.Item.characterSrc;
        const oldBackgroundSrc = existingCharacter.Item.backgroundSrc;
        const newCharacterSrc = updatedCharacter.characterSrc;
        const newBackgroundSrc = updatedCharacter.backgroundSrc;

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

        // Update the character in DynamoDB
        const putCommand = new PutCommand({
            TableName: tableName,
            Item: {
                ...updatedCharacter,
                id: characterId, // Ensure the ID remains the same
            },
        });

        await ddbDocClient.send(putCommand);

        return c.json({
            message: "Character updated successfully",
            character: {
                ...updatedCharacter,
                id: characterId,
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

    const characterId = c.req.param("id");
    if (!characterId) {
        return c.json({ error: "Character ID is required" }, 400);
    }

    try {
        // Get the existing character to find its images
        const getCommand = new GetCommand({
            TableName: tableName,
            Key: { id: characterId },
        });
        const existingCharacter = await ddbDocClient.send(getCommand);

        if (!existingCharacter.Item) {
            return c.json({ error: "Character not found" }, 404);
        }

        // Delete characterSrc from S3 if it exists
        if (existingCharacter.Item.characterSrc) {
            try {
                const deleteCharacterCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingCharacter.Item.characterSrc,
                });
                await s3Client.send(deleteCharacterCommand);
                console.log(
                    `Deleted characterSrc: ${existingCharacter.Item.characterSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete characterSrc ${existingCharacter.Item.characterSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete backgroundSrc from S3 if it exists
        if (existingCharacter.Item.backgroundSrc) {
            try {
                const deleteBackgroundCommand = new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: existingCharacter.Item.backgroundSrc,
                });
                await s3Client.send(deleteBackgroundCommand);
                console.log(
                    `Deleted backgroundSrc: ${existingCharacter.Item.backgroundSrc}`,
                );
            } catch (deleteError: any) {
                console.error(
                    `Failed to delete backgroundSrc ${existingCharacter.Item.backgroundSrc}:`,
                    deleteError,
                );
                // Continue with deletion even if image deletion fails
            }
        }

        // Delete the character from DynamoDB
        const deleteCommand = new DeleteCommand({
            TableName: tableName,
            Key: { id: characterId },
        });

        await ddbDocClient.send(deleteCommand);

        return c.json({
            message: "Character deleted successfully",
            deletedCharacter: existingCharacter.Item,
        });
    } catch (error: any) {
        console.error(error);
        return c.json({ error: error.message }, 500);
    }
});

export default app;
