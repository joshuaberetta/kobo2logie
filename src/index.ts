import { Hono } from "hono";
import { cors } from "hono/cors";
import ui from "./routes/ui.js";
import hook from "./routes/hook.js";
import stream from "./routes/stream.js";
import media from "./routes/media.js";
export { FormSession } from "./FormSession.js";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

// Restrict CORS on API routes to same origin
app.use("/api/*", cors({ origin: (origin) => origin ?? "" }));

// Routes
app.route("/", ui);
app.route("/api/hook", hook);
app.route("/api/stream", stream);
app.route("/api/media", media);

export default app;
