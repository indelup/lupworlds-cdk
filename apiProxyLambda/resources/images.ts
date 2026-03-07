import { Hono } from "hono";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const app = new Hono();
const s3Client = new S3Client({});

const ASSET_PREFIXES = ["characters", "materials", "actions"] as const;
const CONFIG_PREFIXES = ["banners", "config"] as const;
const VALID_PREFIXES = [...ASSET_PREFIXES, ...CONFIG_PREFIXES] as const;
type ValidPrefix = (typeof VALID_PREFIXES)[number];

app.post("/get-presigned-url", async (c) => {
    const assetBucket = process.env.ASSET_IMAGES_BUCKET_NAME;
    const configBucket = process.env.CONFIG_IMAGES_BUCKET_NAME;

    if (!assetBucket || !configBucket) {
        return c.json({ error: "Bucket names not configured" }, 500);
    }

    try {
        const { fileName, contentType, prefix, worldId } = await c.req.json();

        if (!fileName || !contentType || !prefix || !worldId) {
            return c.json(
                { error: "fileName, contentType, prefix, and worldId are required" },
                400,
            );
        }

        if (!VALID_PREFIXES.includes(prefix as ValidPrefix)) {
            return c.json({ error: `Invalid prefix. Must be one of: ${VALID_PREFIXES.join(", ")}` }, 400);
        }

        const bucketName = (ASSET_PREFIXES as readonly string[]).includes(prefix)
            ? assetBucket
            : configBucket;

        const key = `${worldId}/${prefix}/${randomUUID()}`;

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
