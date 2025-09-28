import { Hono, Context } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { verify } from 'jsonwebtoken';
import users from "./resources/users";
import characters from "./resources/characters";
import materials from "./resources/materials";
import banners from "./resources/banners";

const app = new Hono();

app.use(
    "/*",
    cors({
        origin: "http://localhost:8080",
        allowMethods: ["GET", "POST", "PUT", "DELETE"],
        allowHeaders: ["Content-Type", "Authorization"],
        exposeHeaders: ["Content-Length"],
        maxAge: 3600,
        credentials: true,
    }),
);

// Middleware JWT que lee de cookies
app.use("/*", async (c, next) => {
    // Solo aplicar a rutas protegidas (excluir rutas públicas)
    if (c.req.path.startsWith('/health') || c.req.path.startsWith('/status')) {
        return await next();
    }

    // Leer token de cookie en lugar de header
    const cookieHeader = c.req.header("Cookie");
    let token: string | null = null;
    
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            acc[key] = value;
            return acc;
        }, {} as Record<string, string>);
        
        token = cookies.accessToken;
    }

    if (!token) {
        return c.json({ error: "No authentication cookie found" }, 401);
    }

    try {
        const decoded = verify(token, process.env.JWT_SECRET!) as any;
        
        // Verificar expiración
        if (decoded.exp && Date.now() >= decoded.exp * 1000) {
            return c.json({ error: "Token expired" }, 401);
        }
        
        // Agregar información del usuario al contexto
        (c as any).set("user", decoded);
        
        await next();
    } catch (error) {
        console.error('JWT verification error:', error);
        return c.json({ error: "Invalid token" }, 401);
    }
});

// Endpoint para obtener información del usuario actual
app.get("/me", async (c) => {
    const user = (c as any).get("user");
    return c.json(user);
});

// Rutas principales
app.route("/users", users);
app.route("/characters", characters);
app.route("/materials", materials);
app.route("/banners", banners);

export const handler = handle(app);
