require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { createRateLimitStore } = require("./lib/rateLimitStore");

const { startPublishScheduler } = require("./jobs/publishScheduler");
const { startOrphanCleanupJob } = require("./jobs/orphanCleanupJob");
const { startTempFileCleanup } = require("./jobs/tempFileCleanup");
const { startStorageCleanupRetryJob } = require("./jobs/storageCleanupRetryJob");
const { startUserDeletionRetryJob } = require("./jobs/userDeletionRetryJob");

const authRoutes = require("./routes/auth.routes");
const courseRoutes = require("./routes/courses.routes");
const contentRoutes = require("./routes/content.routes");
const planRoutes = require("./routes/plans.routes");
const studentRoutes = require("./routes/students.routes");
const meRoutes = require("./routes/me.routes");
const uploadRoutes = require("./routes/upload.routes");
const fileRoutes = require("./routes/files.routes");
const adminRoutes = require("./routes/admin.routes");
const siteContentRoutes = require("./routes/siteContent.routes");
const meetingRoutes = require("./routes/meetings.routes");
const livekitWebhookRoutes = require("./routes/livekitWebhook.routes");

const app = express();

// Render (and most PaaS hosts) puts this app behind a reverse proxy that
// sets X-Forwarded-For / X-Forwarded-Proto. Without telling Express to
// trust that proxy, req.ip resolves to the proxy's internal IP for every
// request — which means express-rate-limit's per-IP buckets (below) are
// shared across ALL users instead of being per-user, and req.secure /
// req.protocol are unreliable too. `1` = trust exactly one hop (the
// platform's own proxy), which is the correct, safe value for a single
// reverse-proxy deployment like Render's.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0 || TRUST_PROXY_HOPS > 5) {
  throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5.");
}
app.set("trust proxy", TRUST_PROXY_HOPS);

// Spec #15B: explicit production CSP instead of relying on helmet()'s
// defaults. Domains are derived from this deployment's own config
// rather than hard-coded, so a different Supabase project still gets a
// correct policy without editing this file.
//
//  - object-src 'none', base-uri 'self', frame-ancestors 'self': the
//    three directives the spec calls out to always prefer.
//  - script-src / style-src have no 'unsafe-inline'/'unsafe-eval' — the
//    frontend is a Vite/React build with no inline <script> tags and no
//    runtime eval; Tailwind ships as an external stylesheet, and Google
//    Fonts' <link rel="stylesheet"> is an external resource (allowed
//    via style-src's host list), not an inline <style> block.
//  - img-src allows https: broadly (in addition to 'self' and the
//    Supabase host) because course thumbnails / post images are
//    admin-entered arbitrary URLs (see courses.routes.js /
//    content.routes.js httpsUrl validators, which already restrict
//    those inputs to the https: scheme) — this is a deliberate, scoped
//    trade-off, not a wildcard `*` allowance, and every other directive
//    stays tightly scoped.
//  - connect-src/media-src/frame-src include the Supabase project host,
//    since the frontend talks to Supabase Auth directly and video/PDF
//    content is streamed from signed Supabase Storage URLs on that host.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
let supabaseOrigin = null;
try {
  supabaseOrigin = SUPABASE_URL ? new URL(SUPABASE_URL).origin : null;
} catch {
  supabaseOrigin = null;
}
const supabaseSources = supabaseOrigin ? [supabaseOrigin] : [];
// The LiveKit JS SDK doesn't only open the wss:// room-signaling
// connection — it also does a plain HTTPS fetch to the *same host*'s
// `/settings/regions` endpoint for region discovery before connecting.
// `new URL("wss://host").origin` yields the origin "wss://host", and
// CSP source matching is scheme-sensitive, so that alone does NOT
// authorize a "https://host" fetch to the identical host. Without the
// https:// counterpart in connect-src, the browser blocks the regions
// request ("Refused to connect... violates the document's Content
// Security Policy"), which breaks joining/starting meetings on
// LiveKit Cloud. So both scheme variants of the LiveKit host must be
// allowed.
let liveKitSources = [];
try {
  const configuredLiveKitUrl = process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL || "";
  if (configuredLiveKitUrl) {
    const host = new URL(configuredLiveKitUrl).host;
    const isSecure = /^wss:|^https:/.test(configuredLiveKitUrl);
    liveKitSources = isSecure ? [`https://${host}`, `wss://${host}`] : [`http://${host}`, `ws://${host}`];
  }
} catch {
  liveKitSources = [];
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", ...supabaseSources, ...(process.env.ALLOWED_IMAGE_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean)],
        connectSrc: ["'self'", ...supabaseSources, ...liveKitSources],
        // "blob:" is required for the admin's video-thumbnail scrubber
        // (VideoThumbnailPicker), which loads a freshly-picked, not-yet-
        // uploaded video file into a <video> via URL.createObjectURL()
        // so a frame can be captured client-side before the file is sent
        // to the server. This is safe to allow broadly: a blob: URL can
        // only ever reference same-origin-created, in-memory data (the
        // File object the user just selected via <input type="file">)
        // — it is not a way for a remote/attacker-controlled origin to
        // inject arbitrary media.
        mediaSrc: ["'self'", "blob:", ...supabaseSources],
        frameSrc: ["'self'", ...supabaseSources],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);
// CORS only matters for cross-origin requests. In single-URL mode
// (frontend served by this same Express app) the browser calls
// same-origin, so CORS_ORIGIN can be left empty. Set it only if you're
// still hosting the frontend separately (e.g. during `npm run dev`, or a
// separate static host in production).
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "").split(",").filter(Boolean),
    credentials: true,
  })
);
// LiveKit signs its webhook payload over the exact raw request bytes,
// so this one path needs the unparsed body — it must be registered
// *before* the global express.json() below, which would otherwise
// consume and JSON-parse it first.
app.use("/api/livekit/webhook", express.raw({ type: "*/*", limit: "2mb" }));
// Dedicated, more generous limiter for the webhook (exempted from the
// general "/api" one above) — still bounded as defense-in-depth against
// a flood of requests, just sized for legitimate LiveKit traffic
// (potentially many meetings ending in the same window) rather than
// the much lower per-browser-session budget the rest of the API uses.
app.use(
  "/api/livekit/webhook",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 3000, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore("livekit-webhook") })
);
app.use(express.json({ limit: "2mb" }));
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large." });
  }
  next(err);
});
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Default idle-socket timeout for every route (spec #3D). The upload
// route overrides this with a much longer one (UPLOAD_TIMEOUT_MS) since
// server.requestTimeout is disabled above specifically to let large
// uploads run past this value.
const DEFAULT_REQUEST_TIMEOUT_MS = Number(process.env.DEFAULT_REQUEST_TIMEOUT_MS) || 60 * 1000;
app.use((req, res, next) => {
  req.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS);
  next();
});

// Generic API rate limit; auth routes get a stricter one below. These
// counters are process-local because this deployment is intentionally
// single-instance. Horizontal scaling fails closed via REDIS_URL check below.
//
// The LiveKit webhook is excluded: it's authenticated by a cryptographic
// signature (see livekitWebhook.routes.js), not by session/IP trust, so
// throttling it wouldn't add security — it would only risk delaying
// legitimate egress_ended deliveries (recordings stuck in PROCESSING
// until LiveKit's own retry) under a burst of meetings ending close
// together, which is exactly when you'd want this to be reliable.
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: createRateLimitStore("api"),
    skip: (req) => req.originalUrl.startsWith("/api/livekit/webhook"),
  })
);
app.use(
  "/api/auth",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore("auth") })
);

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/me", meRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/site-content", siteContentRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/livekit/webhook", livekitWebhookRoutes);

// ---------------------------------------------------------------------------
// Serve the built frontend so the whole app runs behind a single URL/port.
// Only kicks in if frontend/dist exists (i.e. `npm run build` was run) —
// during `npm run dev` the Vite dev server (port 5173) still proxies /api
// here instead, so local development is unaffected.
// ---------------------------------------------------------------------------
const frontendDistPath = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDistPath)) {
  app.use(
    express.static(frontendDistPath, {
      index: false, // never auto-serve index.html for a directory hit; the SPA fallback below handles it
      maxAge: "1y",
      setHeaders: (res, filePath) => {
        // index.html must always be revalidated so deploys are picked up
        // immediately; hashed assets (Vite's default output) are safe to
        // cache for a long time.
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // SPA fallback: any GET that isn't /api/* and isn't a real static file
  // falls back to index.html so React Router can handle client-side routes
  // like /admin, /dashboard, etc.
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else if (process.env.NODE_ENV === "production") {
  console.warn(
    `[startup] frontend/dist not found at ${frontendDistPath} — the API will still work, ` +
      `but no UI will be served. Run "npm run build" in frontend/ first.`
  );
}

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// Central error handler — never leaks stack traces or secrets to the client.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  const isProduction = process.env.NODE_ENV === "production";
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  const message = status >= 500 && isProduction
    ? "Something went wrong. Please try again."
    : (typeof err?.message === "string" && err.message ? err.message : "Request failed.");
  res.status(status).json({ error: message });
});

// Fail closed for horizontally scaled deployments until shared upload
// concurrency/temp-disk accounting is explicitly configured. Redis-backed
// rate limiting without shared upload gating would create a misleading
// partial security boundary, so REDIS_URL is rejected for this build.
if (process.env.REDIS_URL) {
  throw new Error(
    "REDIS_URL is not supported by this build because upload concurrency and temp-disk limits are not globally shared. " +
    "Keep a single backend instance, or implement a shared upload gate before enabling horizontal scaling."
  );
}
if (process.env.ADMIN_BOOTSTRAP_TOKEN && process.env.NODE_ENV === "production") {
  console.warn("[security] ADMIN_BOOTSTRAP_TOKEN is enabled in production. Remove it immediately after bootstrap.");
}
{
  // Meeting recording is all-or-nothing (see recordingConfig.js) —
  // warn loudly at boot if it looks half-configured, since a silently
  // disabled recording feature (every live meeting quietly not
  // recording) is much harder to notice than a startup log line.
  const { recordingEnabled } = require("./lib/recordingConfig");
  const recordingVars = ["SUPABASE_S3_ACCESS_KEY", "SUPABASE_S3_SECRET_KEY", "SUPABASE_S3_REGION", "SUPABASE_S3_ENDPOINT"];
  const setCount = recordingVars.filter((k) => !!process.env[k]).length;
  if (setCount > 0 && !recordingEnabled()) {
    console.warn(
      `[startup] Meeting recording looks partially configured (${setCount}/${recordingVars.length} of ${recordingVars.join(", ")} set) ` +
        `but is not enabled — check infra/livekit/README.md. Live meetings will run normally but will not be recorded.`
    );
  } else if (recordingEnabled()) {
    console.log("[startup] Meeting recording is enabled (LiveKit Egress -> Supabase S3-compatible Storage).");
  }
}

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Course CRM API listening on port ${PORT}`);
  startPublishScheduler();
  startOrphanCleanupJob();
  startTempFileCleanup();
  startStorageCleanupRetryJob();
  startUserDeletionRetryJob();
});

// Idle-connection / header timeouts (spec #3D). Node's own
// `server.requestTimeout` applies to *every* request regardless of
// route and would kill a legitimate multi-minute large-file upload, so
// it's disabled here; the upload route instead sets its own longer
// per-request idle timeout (UPLOAD_TIMEOUT_MS in upload.routes.js), and
// every other route gets a much shorter default idle timeout below so a
// slow-loris-style connection on a small JSON endpoint can't be held
// open indefinitely.
server.headersTimeout = Number(process.env.SERVER_HEADERS_TIMEOUT_MS) || 65 * 1000;
server.requestTimeout = 0; // disabled server-wide; see per-route timeouts instead
server.keepAliveTimeout = Number(process.env.SERVER_KEEPALIVE_TIMEOUT_MS) || 61 * 1000;


function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  server.close((err) => {
    if (err) { console.error("[shutdown] server close failed", err); process.exitCode = 1; }
    process.exit();
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("[process] unhandledRejection", reason));
process.on("uncaughtException", (err) => { console.error("[process] uncaughtException", err); shutdown("uncaughtException"); });
