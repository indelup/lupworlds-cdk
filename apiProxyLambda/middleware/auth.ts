import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { getJwtSecret } from "../lib/secrets";
import type {
    AppEnv,
    AccessTokenPayload,
    OverlayTokenPayload,
    ServiceTokenPayload,
    CallerContext,
} from "../types/auth";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    // Skip auth for the Twitch OAuth callback
    if (c.req.method === "GET" && c.req.path.endsWith("/auth/twitch/callback")) {
        return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const secret = await getJwtSecret();

    let payload: Record<string, unknown>;
    try {
        payload = (await verify(token, secret, "HS256")) as Record<string, unknown>;
    } catch {
        return c.json({ error: "Unauthorized" }, 401);
    }

    if (payload.iss !== "lupworlds") {
        return c.json({ error: "Unauthorized" }, 401);
    }

    let caller: CallerContext;

    switch (payload.typ) {
        case "access": {
            const p = payload as unknown as AccessTokenPayload;
            caller = {
                type: "user",
                userId: p.sub,
                platform: p.platform,
                platformId: p.platformId,
                roles: p.roles,
                worldId: p.worldId,
            };
            break;
        }
        case "overlay": {
            const p = payload as unknown as OverlayTokenPayload;
            if (payload.aud !== "overlay") {
                return c.json({ error: "Unauthorized" }, 401);
            }
            caller = {
                type: "overlay",
                wid: p.wid,
                scopes: p.scopes,
            };
            break;
        }
        case "service": {
            const p = payload as unknown as ServiceTokenPayload;
            caller = {
                type: "bot",
                scopes: p.scopes,
            };
            break;
        }
        default:
            return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("caller", caller);
    return next();
};
