import { Hono } from "hono";
import { cors } from "hono/cors";
import ui from "./routes/ui.js";
import hook from "./routes/hook.js";
import stream from "./routes/stream.js";
import media from "./routes/media.js";
import configure from "./routes/configure.js";
import retry from "./routes/retry.js";
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
app.route("/api/configure", configure);
app.route("/api/retry", retry);

// Submission log for a form
app.get("/api/logs/:formUID", async (c) => {
  const formUID = c.req.param("formUID");
  const id = c.env.FORM_SESSION.idFromName(formUID);
  const stub = c.env.FORM_SESSION.get(id);
  const qs = new URL(c.req.url).search;
  const res = await stub.fetch("https://do/logs" + qs);
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});

export default app;
