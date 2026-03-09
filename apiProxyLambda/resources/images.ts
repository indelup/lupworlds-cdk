import { Hono } from "hono";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { requireNotOverlay } from "../middleware/authorization";
import type { AppEnv } from "../types/auth";

const app = new Hono<AppEnv>();
const s3Client = new S3Client({});

const ASSET_PREFIXES = ["characters", "materials", "actions"] as const;
const CONFIG_PREFIXES = ["banners", "logos", "backgrounds", "cardbacks", "currencies"] as const;
const VALID_PREFIXES = [...ASSET_PREFIXES, ...CONFIG_PREFIXES] as const;
type ValidPrefix = (typeof VALID_PREFIXES)[number];

const RESIZE_MAP: Record<string, { w: number; h: number }> = {
    characters: { w: 500, h: 700 },
    materials: { w: 500, h: 700 },
    actions: { w: 500, h: 700 },
    banners: { w: 1000, h: 300 },
    logos: { w: 500, h: 500 },
    backgrounds: { w: 1920, h: 1080 },
    cardbacks: { w: 500, h: 700 },
    currencies: { w: 100, h: 100 },
};

app.get("/:key{.+}", async (c) => {
    const assetBucket = process.env.ASSET_IMAGES_BUCKET_NAME;
    const configBucket = process.env.CONFIG_IMAGES_BUCKET_NAME;

    if (!assetBucket || !configBucket) {
        return c.json({ error: "Bucket names not configured" }, 500);
    }

    const key = c.req.param("key") ?? "";
    const prefix = key.split("/")[1];
    const dims = RESIZE_MAP[prefix];

    if (!dims) {
        return c.json({ error: `Unknown prefix: ${prefix}` }, 400);
    }

    const sourceBucket = (ASSET_PREFIXES as readonly string[]).includes(prefix)
        ? assetBucket
        : configBucket;
    const cachedKey = `_resized/${dims.w}x${dims.h}/${key}`;

    // Try cache hit
    try {
        const cached = await s3Client.send(
            new GetObjectCommand({ Bucket: sourceBucket, Key: cachedKey }),
        );
        const bytes = await cached.Body!.transformToByteArray();
        return new Response(bytes, {
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000" },
        });
    } catch (e: any) {
        if (e.name !== "NoSuchKey") console.error("Cache check error:", e);
    }

    // Fetch original
    let original;
    try {
        original = await s3Client.send(
            new GetObjectCommand({ Bucket: sourceBucket, Key: key }),
        );
    } catch (e: any) {
        if (e.name === "NoSuchKey") return c.json({ error: "Not found" }, 404);
        throw e;
    }

    const originalBytes = await original.Body!.transformToByteArray();
    const buffer = Buffer.from(originalBytes);

    // Resize
    const resized = await sharp(buffer)
        .resize(dims.w, dims.h, { fit: "contain", background: "#ffffff" })
        .jpeg()
        .toBuffer();

    // Write cache (awaited — Lambda may freeze before fire-and-forget completes)
    try {
        await s3Client.send(
            new PutObjectCommand({
                Bucket: sourceBucket,
                Key: cachedKey,
                Body: resized,
                ContentType: "image/jpeg",
            }),
        );
    } catch (e) {
        console.error("Cache write error:", e);
    }

    return new Response(resized, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000" },
    });
});

app.post("/get-presigned-url", requireNotOverlay, async (c) => {
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
            return c.json(
                { error: `Invalid prefix. Must be one of: ${VALID_PREFIXES.join(", ")}` },
                400,
            );
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
