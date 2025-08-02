import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import characters from "./resources/characters";
import users from "./resources/users";

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

app.route("/characters", characters);
app.route("/users", users);

export const handler = handle(app);
