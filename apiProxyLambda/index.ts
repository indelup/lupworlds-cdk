import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { authMiddleware } from "./middleware/auth";
import auth from "./resources/auth";
import users from "./resources/users";
import characters from "./resources/characters";
import materials from "./resources/materials";
import actions from "./resources/actions";
import banners from "./resources/banners";
import playerData from "./resources/playerData";
import worlds from "./resources/worlds";
import images from "./resources/images";
import type { AppEnv } from "./types/auth";

const app = new Hono<AppEnv>();

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

app.use("/*", authMiddleware);

app.route("/auth", auth);
app.route("/users", users);
app.route("/characters", characters);
app.route("/materials", materials);
app.route("/actions", actions);
app.route("/banners", banners);
app.route("/player-data", playerData);
app.route("/worlds", worlds);
app.route("/images", images);

export const handler = handle(app);
