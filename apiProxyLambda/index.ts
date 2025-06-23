import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import characters from "./resources/characters";
import users from "./resources/users";

const app = new Hono();

app.route("/characters", characters);
app.route("/users", users);

export const handler = handle(app);
