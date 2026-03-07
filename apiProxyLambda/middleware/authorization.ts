import { MiddlewareHandler } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { AppEnv } from "../types/auth";

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Blocks overlay callers
export const requireNotOverlay: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.get("caller").type === "overlay") return c.json({ error: "Forbidden" }, 403);
    return next();
};

// Resolves worldId before POST handlers:
// - overlay → 403
// - user    → worldId from token (no body parse needed)
// - bot     → worldId from body (god access, operates across worlds)
// Parses and caches body in context so handlers don't re-parse
export const resolveWorldId: MiddlewareHandler<AppEnv> = async (c, next) => {
    const caller = c.get("caller");
    if (caller.type === "overlay") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json();
    c.set("parsedBody", body);

    if (caller.type === "user") {
        c.set("worldId", caller.worldId);
    } else {
        if (!body.worldId) return c.json({ error: "worldId is required" }, 400);
        c.set("worldId", body.worldId as string);
    }
    return next();
};

// For world upsert (PUT /worlds/:id) — worldId is the URL param, item may not exist yet
export function requireWorldWrite(param = "id"): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const caller = c.get("caller");
        if (caller.type === "overlay") return c.json({ error: "Forbidden" }, 403);
        if (caller.type === "user" && caller.worldId !== c.req.param(param)) {
            return c.json({ error: "Forbidden" }, 403);
        }
        return next();
    };
}

// For PUT/DELETE — fetches item, checks world-scope, exposes item via context
export function requireItemWorldWrite(tableName: string, param = "id"): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const id = c.req.param(param);
        try {
            const response = await ddbDocClient.send(
                new GetCommand({ TableName: tableName, Key: { id } }),
            );
            if (!response.Item) return c.json({ error: "Not found" }, 404);

            const caller = c.get("caller");
            if (caller.type === "overlay") return c.json({ error: "Forbidden" }, 403);
            if (caller.type === "user" && caller.worldId !== response.Item.worldId) {
                return c.json({ error: "Forbidden" }, 403);
            }

            c.set("existingItem", response.Item as Record<string, unknown>);
        } catch (error: any) {
            console.error(error);
            return c.json({ error: error.message }, 500);
        }
        return next();
    };
}
