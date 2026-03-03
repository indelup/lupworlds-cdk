import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import users from "./resources/users";
import characters from "./resources/characters";
import materials from "./resources/materials";
import actions from "./resources/actions";
import banners from "./resources/banners";
import playerData from "./resources/playerData";
import worlds from "./resources/worlds";

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

app.route("/users", users);
app.route("/characters", characters);
app.route("/materials", materials);
app.route("/actions", actions);
app.route("/banners", banners);
app.route("/player-data", playerData);
app.route("/worlds", worlds);

export const handler = handle(app);
