const express = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { supabase, assertNoError } = require("../lib/db");
const { uploadFile } = require("../lib/storage");
const { authenticate, requireAdmin } = require("../middleware/auth");
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
} = require("../lib/fileValidation");
const { logAction } = require("../services/auditService");
const { tryAcquireUploadSlot, releaseUploadSlot } = require("../lib/uploadGate");

// Per-user daily upload quota (spec #15A). Enforced atomically in
// Postgres via try_reserve_upload_quota() (see supabase/schema.sql) —
// a `select ... for update` row lock on the user's per-day counter, so
// concurrent uploads near the boundary can't both read the same
// "before" value and both slip through.
const MAX_USER_UPLOAD_BYTES_PER_DAY = Number(process.env.MAX_USER_UPLOAD_BYTES_PER_DAY) || 5 * 1024 * 1024 * 1024; // 5GB

const router = express.Router();

// Dedicated, tighter rate limit for uploads on top of the app-wide one in
// index.js — protects against upload-flooding even from an authenticated
// admin account (compromised credentials, buggy client, etc).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT_PER_15MIN) || 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Explicit upload timeout (spec #3D) — large uploads must not be left
// dependent only on default server/network timeouts, which are tuned
// for small JSON requests elsewhere in this app.
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS) || 15 * 60 * 1000; // 15 min

// Concurrency + temp-disk gate (spec #3C/#3G): rejects a new upload
// before multer even starts writing to disk if the instance is already
// at its concurrent-upload or temp-storage ceiling. Uses the request's
// declared Content-Length as the size estimate — an honest client's
// upper bound, and even an inflated one only makes this gate stricter.
function uploadGate(req, res, next) {
  req.setTimeout(UPLOAD_TIMEOUT_MS);
  res.setTimeout(UPLOAD_TIMEOUT_MS);

  const declaredBytes = Number(req.headers["content-length"]);
  const slot = tryAcquireUploadSlot(declaredBytes);
  if (!slot.ok) {
    return res.status(503).json({ error: slot.reason });
  }
  req._uploadSlotBytes = slot.bytes;
  req._uploadSlotReleased = false;

  const release = () => {
    if (req._uploadSlotReleased) return;
    req._uploadSlotReleased = true;
    releaseUploadSlot(req._uploadSlotBytes);
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
// and always removed afterwards (success or failure).
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const name = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Recorded on `req` (not just the multer file object) so the
      // uploadGate cleanup handler above can unlink it even if the
      // request aborts before multer's own callback chain finishes.
      req._uploadTempPath = path.join(os.tmpdir(), name);
      cb(null, name);
    },
  }),
  limits: {
    fileSize: maxPossibleSizeBytes(), // hard ceiling; the real per-type limit is enforced below
    files: 1,
  },
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
router.post("/", authenticate, requireAdmin, uploadLimiter, uploadGate, upload.single("file"), async (req, res, next) => {
  let tempPath = req.file && req.file.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const type = req.query.type || req.body.type;
    const courseId = req.body.courseId || req.query.courseId;
    if (!courseId || !isSafeId(courseId)) {
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
        await supabase.rpc("release_upload_quota", { p_user_id: req.user.id, p_bytes: req.file.size }).catch(() => {});
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
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }
  if (err && err.message && !err.status) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
