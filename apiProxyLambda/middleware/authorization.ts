import type { MiddlewareHandler } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { AppEnv } from "../types/auth";

const dbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dbClient);

export const requireNotOverlay: MiddlewareHandler<AppEnv> = async (c, next) => {
    const caller = c.get("caller");
    if (caller.type === "overlay") {
        return c.json({ error: "Forbidden" }, 403);
    }
    return next();
};

export const resolveWorldId: MiddlewareHandler<AppEnv> = async (c, next) => {
    const caller = c.get("caller");

    if (caller.type === "overlay") {
        return c.json({ error: "Forbidden" }, 403);
    }

    let worldId: string;
    if (caller.type === "user") {
        worldId = caller.worldId;
    } else {
        // bot: reads worldId from body
        const body = await c.req.json();
        worldId = body.worldId;
        // Re-inject raw body so downstream handlers can parse it again
        c.req.raw = new Request(c.req.raw.url, {
            method: c.req.raw.method,
            headers: c.req.raw.headers,
            body: JSON.stringify(body),
        });
    }

    if (!worldId) {
        return c.json({ error: "worldId is required" }, 400);
    }

    c.set("worldId", worldId);
    return next();
};

export function requireWorldWrite(param: string): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const caller = c.get("caller");

        if (caller.type === "overlay") {
            return c.json({ error: "Forbidden" }, 403);
        }
        if (caller.type === "bot") {
            return next();
        }

        // user: worldId in URL param must match token's worldId
        const paramValue = c.req.param(param);
        if (caller.worldId !== paramValue) {
            return c.json({ error: "Forbidden" }, 403);
        }
        return next();
    };
}

export function requireSelfDataWrite(param: string): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const caller = c.get("caller");

        if (caller.type === "overlay") {
            return c.json({ error: "Forbidden" }, 403);
        }
        if (caller.type === "bot") {
            return next();
        }

        // user: userId in URL param must match token's userId
        const paramValue = c.req.param(param);
        if (caller.userId !== paramValue) {
            return c.json({ error: "Forbidden" }, 403);
        }
        return next();
    };
}

export function requireItemWorldWrite(
    tableName: string,
    param: string,
): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const caller = c.get("caller");

        if (caller.type === "overlay") {
            return c.json({ error: "Forbidden" }, 403);
        }

        const itemId = c.req.param(param);
        if (!itemId) {
            return c.json({ error: "ID is required" }, 400);
        }

        const result = await ddbDocClient.send(
            new GetCommand({ TableName: tableName, Key: { id: itemId } }),
        );

        if (!result.Item) {
            return c.json({ error: "Not found" }, 404);
        }

        if (caller.type === "user" && caller.worldId !== result.Item.worldId) {
            return c.json({ error: "Forbidden" }, 403);
        }

        c.set("existingItem", result.Item as Record<string, unknown>);
        return next();
    };
}
