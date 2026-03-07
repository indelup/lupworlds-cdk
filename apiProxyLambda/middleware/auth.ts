import { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { AppEnv, CallerContext, Role } from "../types/auth";
import { getJwtSecret } from "../lib/secrets";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    // Public route: skip auth for Twitch OAuth callback
    if (c.req.method === "GET" && c.req.path === "/auth/twitch/callback") {
        return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);

    let payload: Record<string, unknown>;
    try {
        const jwtSecret = await getJwtSecret();
        payload = (await verify(token, jwtSecret, "HS256")) as Record<string, unknown>;
    } catch {
        return c.json({ error: "Unauthorized" }, 401);
    }

    if (payload.iss !== "lupworlds") {
        return c.json({ error: "Unauthorized" }, 401);
    }

    let caller: CallerContext;

    switch (payload.typ) {
        case "access":
            caller = {
                type: "user",
                userId: payload.sub as string,
                platform: payload.platform as string,
                platformId: payload.platformId as string,
                roles: (payload.roles as Role[]) ?? [],
                worldId: payload.worldId as string,
            };
            break;
        case "overlay":
            if (payload.aud !== "overlay") {
                return c.json({ error: "Unauthorized" }, 401);
            }
            caller = {
                type: "overlay",
                wid: payload.wid as string,
                scopes: payload.scopes as ["world:read"],
            };
            break;
        case "service":
            caller = {
                type: "bot",
                scopes: payload.scopes as ["bot:*"],
            };
            break;
        default:
            console.warn("[auth] Unknown token typ:", payload.typ);
            return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("caller", caller);
    return next();
};
