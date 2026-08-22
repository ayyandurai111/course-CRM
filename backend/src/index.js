require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { startPublishScheduler } = require("./jobs/publishScheduler");
const { startOrphanCleanupJob } = require("./jobs/orphanCleanupJob");
const { startTempFileCleanup } = require("./jobs/tempFileCleanup");
const { startStorageCleanupRetryJob } = require("./jobs/storageCleanupRetryJob");

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

const app = express();

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

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "https:", "data:", ...supabaseSources],
        connectSrc: ["'self'", ...supabaseSources],
        mediaSrc: ["'self'", ...supabaseSources],
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
app.use(express.json({ limit: "2mb" }));
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

// Generic API rate limit; auth routes get a stricter one below.
app.use(
  "/api",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/auth",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false })
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
  console.error(err);
  const status = err.status || 500;
  const message = status === 500 ? "Something went wrong. Please try again." : err.message;
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Course CRM API listening on port ${PORT}`);
  startPublishScheduler();
  startOrphanCleanupJob();
  startTempFileCleanup();
  startStorageCleanupRetryJob();
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
