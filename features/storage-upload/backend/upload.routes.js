const express = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createRateLimitStore } = require("../../../shared/backend-core/rateLimitStore");
const { supabase, assertNoError } = require("../../../shared/backend-core/db");
const { uploadFile } = require("./storage.lib");
const { authenticate, requireAdmin } = require("../../auth/backend/auth.middleware");
const {
  UPLOAD_RULES,
  maxSizeBytesFor,
  maxPossibleSizeBytes,
  safeExtension,
  isExtensionAllowed,
  isMimeAllowed,
  matchesFileSignature,
  buildStoragePath,
  isSafeId,
} = require("./fileValidation.lib");
const { logAction } = require("../../audit/backend/auditService");
const { tryAcquireUploadSlot, releaseUploadSlot, releaseBytes } = require("./uploadGate.lib");
const { createMeteredDiskStorage } = require("./meteredUploadStorage.lib");

// Per-user daily upload quota (spec #15A). Enforced atomically in
// Postgres via try_reserve_upload_quota() (see supabase/schema.sql) —
// a `select ... for update` row lock on the user's per-day counter, so
// concurrent uploads near the boundary can't both read the same
// "before" value and both slip through.
const MAX_USER_UPLOAD_BYTES_PER_DAY = Number(process.env.MAX_USER_UPLOAD_BYTES_PER_DAY) || 5 * 1024 * 1024 * 1024; // 5GB

const router = express.Router();

// Dedicated, tighter rate limit for uploads on top of the app-wide one in
// index.js — protects against upload-flooding even from an authenticated
// admin account (compromised credentials, buggy client, etc). Store
// selection (spec #10): see lib/rateLimitStore.js — per-process unless
// REDIS_URL + the optional Redis packages are configured.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_PER_15MIN) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore("upload"),
});

// Explicit upload timeout (spec #3D) — large uploads must not be left
// dependent only on default server/network timeouts, which are tuned
// for small JSON requests elsewhere in this app.
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS) || 15 * 60 * 1000; // 15 min

// Concurrency gate (spec #3C): rejects a new upload before multer even
// starts writing to disk if the instance is already at its
// concurrent-upload ceiling. Temp-disk *byte* accounting is handled
// separately and live (see meteredDiskStorage below) — it is
// deliberately NOT derived from Content-Length, which a client can omit
// entirely (`Transfer-Encoding: chunked`) to make the old reservation
// logic see 0 bytes while a large file is still written to disk.
function uploadGate(req, res, next) {
  req.setTimeout(UPLOAD_TIMEOUT_MS);
  res.setTimeout(UPLOAD_TIMEOUT_MS);

  const slot = tryAcquireUploadSlot();
  if (!slot.ok) {
    return res.status(503).json({ error: slot.reason });
  }
  req._uploadSlotReleased = false;

  const release = () => {
    if (req._uploadSlotReleased) return;
    req._uploadSlotReleased = true;
    releaseUploadSlot();
    // Release whatever bytes were live-metered for this upload,
    // however far it got (0 if it never started streaming).
    releaseBytes(req._uploadReservedBytes || 0);
    // Belt-and-suspenders temp-file cleanup: covers a client
    // disconnecting mid-upload, before the route handler's own
    // try/finally ever runs (spec #3I "client disconnect during
    // upload"). Harmless to attempt again on the normal success path —
    // the file is already gone by then and unlink of a missing path is
    // silently ignored.
    if (req._uploadTempPath) {
      fs.promises.unlink(req._uploadTempPath).catch(() => {});
    }
  };
  // `close` fires for both a normal completed response and an aborted
  // one; `finish` only fires once the response was actually sent.
  res.on("close", release);
  res.on("finish", release);
  next();
}

// Files are streamed to local disk (OS temp dir), never buffered whole
// in process memory — a 500MB video would otherwise be held entirely in
// RAM under multer.memoryStorage(), which can crash the server under
// concurrent uploads. The temp file is streamed on to Supabase Storage
// and always removed afterwards (success or failure). Byte accounting
// against the shared temp-disk pool happens live in this storage engine
// (see lib/meteredUploadStorage.js) rather than from Content-Length, so
// a chunked request with no Content-Length is bounded the same as any
// other (spec fix: chunked-upload resource-exhaustion bypass).
// Multipart parsing limits (spec fix — "Harden Multer Multipart
// Parsing"). Previously only `fileSize` and `files` were set, leaving
// busboy/multer's other limits at permissive defaults (`fields` and
// `parts` effectively unbounded, `headerPairs` at 2000, and
// `fieldNestingDepth` — a multer-specific option layered on top of
// busboy, see node_modules/multer/lib/make-middleware.js — unset,
// meaning a bracket-notation field name like `a[b][c][d]...` is
// expanded into an arbitrarily deep nested object with no limit at
// all). None of that is reachable from a legitimate request to this
// route, which only ever sends two flat non-file fields (`type`,
// `courseId`) alongside one file.
const MULTIPART_LIMITS = {
  fileSize: maxPossibleSizeBytes(), // hard per-file ceiling, enforced by busboy independent of Content-Length; the real per-type limit is enforced below
  files: 1,
  fields: 20, // only `type`/`courseId` are ever used; generous headroom without being unbounded
  fieldNameSize: 100, // busboy default
  fieldSize: 2 * 1024, // field values here are short (UUID/enum) — no legitimate reason to allow more
  parts: 25, // fields + files combined
  headerPairs: 50, // busboy default is 2000; a handful of headers per part is all this route ever needs
  fieldNestingDepth: 2, // rejects deeply-nested bracket-notation field names (e.g. a[b][c][d]...) outright
};

const upload = multer({
  storage: createMeteredDiskStorage(),
  limits: MULTIPART_LIMITS,
  fileFilter: (req, file, cb) => {
    const type = req.query.type || req.body.type;
    const rule = UPLOAD_RULES[type];
    if (!rule) return cb(new Error("A valid content `type` (VIDEO, PDF, or POST) is required."));

    const ext = safeExtension(file.originalname);
    if (!isExtensionAllowed(type, ext)) {
      return cb(new Error(`File extension ${ext || "(none)"} is not allowed for ${type} content.`));
    }
    if (!isMimeAllowed(type, file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} is not allowed for ${type} content.`));
    }
    cb(null, true);
  },
});

async function removeTempFile(filePath) {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

/**
 * Admin-only. Requires `courseId` and `type` alongside the file.
 *
 * Storage layout matches the required architecture:
 *   courses/{courseId}/{videos|pdfs|images}/{contentId}/{generatedFileName}
 *
 * Since the `content` row is normally created *after* the upload (the
 * admin fills the rest of the form first), we reserve a content id up
 * front with crypto.randomUUID() — a real Postgres `uuid`, matching the
 * `content.id uuid default gen_random_uuid()` column — and hand it back
 * to the client so the follow-up POST/PATCH /api/content call reuses
 * the same id (passed explicitly on insert, rather than left to the
 * column default). This keeps every uploaded file's storage path
 * anchored to a real content row instead of a throwaway random folder.
 */
const ALLOWED_UPLOAD_FIELDS = new Set(["type", "courseId"]);

/**
 * Pure — validates the non-file field names multer parsed into
 * req.body. Extracted so the "reject excessively nested/unexpected
 * multipart fields" behavior (see doc comment at the call site below)
 * is directly unit-testable without spinning up the full authenticated
 * route + Supabase-backed handler.
 */
function findUnexpectedUploadField(body) {
  for (const key of Object.keys(body || {})) {
    if (!ALLOWED_UPLOAD_FIELDS.has(key)) return key;
  }
  return null;
}

router.post("/", authenticate, requireAdmin, uploadLimiter, uploadGate, upload.single("file"), async (req, res, next) => {
  let tempPath = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    // Defense-in-depth on top of `limits.fieldNestingDepth` above: this
    // route has exactly two legitimate non-file fields, so strictly
    // allowlist the top-level field names it will accept at all — a
    // field name that produced any other top-level key (nested or not)
    // is rejected outright, regardless of whether it happened to fit
    // under the nesting-depth limit.
    const unexpectedField = findUnexpectedUploadField(req.body);
    if (unexpectedField) {
      return res.status(400).json({ error: `Unexpected form field "${unexpectedField}".` });
    }

    const type = req.query.type || req.body.type;
    const courseId = req.body.courseId || req.query.courseId;
    if (typeof type !== "string" || !UPLOAD_RULES[type]) {
      return res.status(400).json({ error: "A valid content `type` (VIDEO, PDF, or POST) is required." });
    }
    if (!courseId || typeof courseId !== "string" || !isSafeId(courseId)) {
      return res.status(400).json({ error: "A valid `courseId` is required." });
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .maybeSingle();
    assertNoError(courseError, "Failed to load course");
    if (!course) {
      return res.status(404).json({ error: "Course not found." });
    }

    // Re-check size against the *type-specific* limit — multer only
    // enforced the widest possible ceiling above.
    const maxBytes = maxSizeBytesFor(type);
    if (req.file.size > maxBytes) {
      return res.status(413).json({ error: `File exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit for ${type} content.` });
    }

    // Magic-byte check: read just the first bytes rather than the whole
    // file, so this stays cheap even for a 500MB video.
    const handle = await fs.promises.open(tempPath, "r");
    const header = Buffer.alloc(16);
    await handle.read(header, 0, 16, 0);
    await handle.close();
    if (!matchesFileSignature(type, header)) {
      return res.status(415).json({ error: "File content does not match its declared type." });
    }

    const contentId = crypto.randomUUID();
    const ext = safeExtension(req.file.originalname);
    const { storagePath, generatedFileName } = buildStoragePath({ courseId, contentId, type, ext });

    // Reserve today's quota for this user using the *actual* uploaded
    // size (multer already streamed the whole file to temp disk by this
    // point), not the client's declared Content-Length. Reserved only
    // right before the real Storage push, and released again if that
    // push fails, so a failed upload does not incorrectly consume quota
    // (spec #15A).
    let quotaReserved = false;
    try {
      const { error: quotaError } = await supabase.rpc("try_reserve_upload_quota", {
        p_user_id: req.user.id,
        p_bytes: req.file.size,
        p_max_bytes: MAX_USER_UPLOAD_BYTES_PER_DAY,
      });
      if (quotaError) {
        const err = new Error("Daily upload quota exceeded. Please try again tomorrow.");
        err.status = 429;
        throw err;
      }
      quotaReserved = true;

      await uploadFile(tempPath, storagePath, req.file.mimetype);
    } catch (uploadErr) {
      if (quotaReserved) {
        // supabase.rpc(...) returns a PostgrestFilterBuilder, which is
        // "thenable" (supports await) but does NOT implement a real
        // .catch() method — chaining .catch() directly on it throws
        // "supabase.rpc(...).catch is not a function" and, worse,
        // *replaces* uploadErr below with that TypeError, hiding the
        // actual upload failure. Wrap it in a real try/catch instead.
        try {
          const { error: releaseError } = await supabase.rpc("release_upload_quota", {
            p_user_id: req.user.id,
            p_bytes: req.file.size,
          });
          if (releaseError) {
            console.error("[upload] release_upload_quota failed:", releaseError.message);
          }
        } catch (releaseErr) {
          console.error("[upload] release_upload_quota threw:", releaseErr);
        }
      }
      throw uploadErr;
    }

    await logAction({
      actorId: req.user.id,
      action: "file.upload",
      entityType: "Content",
      entityId: contentId,
      metadata: { courseId, type, fileSizeBytes: req.file.size },
    });

    res.status(201).json({
      contentId,
      fileKey: storagePath,
      fileName: generatedFileName,
      fileSizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
    });
  } catch (err) {
    next(err);
  } finally {
    await removeTempFile(tempPath);
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("[upload] MulterError:", err.code, err.message, err.field);
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  if (err && err.message && !err.status) {
    // Logged here (not just left to the global handler) because this
    // branch intentionally exposes err.message to the client as-is —
    // if that message ever comes from something other than our own
    // deliberate validation throws (e.g. a wrapped Supabase/storage
    // error via assertNoError), we want it visible in server logs too,
    // not just guessed at from a byte count in the access log.
    console.error("[upload] 400:", err.message);
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
module.exports.MULTIPART_LIMITS = MULTIPART_LIMITS;
module.exports.findUnexpectedUploadField = findUnexpectedUploadField;
