const fs = require("fs");
const { Readable } = require("stream");
const { supabase, STORAGE_BUCKET } = require("./supabase");

// Separate PUBLIC bucket, only for course thumbnails. The main
// STORAGE_BUCKET above is private and only ever read via short-lived
// signed URLs (see getSignedUrl below) because it holds paid course
// content. Thumbnails are the opposite: they need to be visible on the
// public landing page indefinitely, without auth and without an
// expiring URL, so they get their own bucket that's actually public in
// Supabase Storage (see supabase/migrations for the bucket creation).
const THUMBNAIL_BUCKET = process.env.SUPABASE_THUMBNAIL_BUCKET || "course-thumbnails";

// Spec #14: explicit timeout for Storage operations, so a hung Storage
// API call can't hold a request (and its underlying temp file/DB
// connection) open indefinitely. This can't literally abort the
// in-flight HTTP call inside @supabase/storage-js (it doesn't expose an
// AbortSignal on every method), so it's a bounded *wait*: the caller
// gets a controlled timeout error back and can respond to the client /
// clean up its own resources, even if the underlying request is still
// finishing server-side in the background.
const STORAGE_OPERATION_TIMEOUT_MS = Number(process.env.STORAGE_OPERATION_TIMEOUT_MS) || 30 * 1000;
// Uploads are large, long-running transfers and need their own much
// longer ceiling — reuses the same budget as the route-level
// UPLOAD_TIMEOUT_MS (upload.routes.js) so the two stay consistent.
const STORAGE_UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS) || 15 * 60 * 1000;

class StorageTimeoutError extends Error {
  constructor(label) {
    super(`Storage operation timed out: ${label}`);
    this.name = "StorageTimeoutError";
  }
}

function withTimeout(promise, label, ms = STORAGE_OPERATION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StorageTimeoutError(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Streams a local temp file up to Storage at `storagePath` without ever
 * holding the whole file in process memory. A 500MB video read fully
 * via fs.readFile() would sit entirely in the Node.js heap/external
 * memory during upload; multiplied across a few concurrent uploads that
 * is enough to OOM the process. `@supabase/storage-js`'s upload() body
 * accepts a web ReadableStream (it sets `duplex: 'half'` on the
 * underlying fetch automatically whenever the body is a stream), so
 * converting the Node fs.ReadableStream once with Readable.toWeb() keeps
 * this a true disk-to-network transfer: only the current chunk is ever
 * resident in memory.
 */
async function uploadFile(tempPath, storagePath, contentType) {
  const nodeStream = fs.createReadStream(tempPath);
  const webStream = Readable.toWeb(nodeStream);
  try {
    const { error } = await withTimeout(
      supabase.storage.from(STORAGE_BUCKET).upload(storagePath, webStream, {
        contentType,
        upsert: false,
        // Mirrors the old Firebase Storage metadata — never cached by
        // shared/browser caches since access is gated per-request.
        cacheControl: "0",
      }),
      `upload ${storagePath}`,
      STORAGE_UPLOAD_TIMEOUT_MS
    );
    if (error) throw error;
  } finally {
    if (!nodeStream.destroyed) nodeStream.destroy();
  }
}

/** Best-effort delete; never throws — caller decides how to handle failure. */
async function deleteFileSafely(storagePath) {
  if (!storagePath) return { ok: true };
  try {
    const { error } = await withTimeout(
      supabase.storage.from(STORAGE_BUCKET).remove([storagePath]),
      `delete ${storagePath}`
    );
    // Supabase Storage doesn't error on a missing object (mirrors
    // Firebase's ignoreNotFound: true), so any error here is a real failure.
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error(`Failed to delete Storage object ${storagePath}:`, err);
    return { ok: false, error: err };
  }
}

/** True if an object exists at `storagePath`. */
async function fileExists(storagePath) {
  const folder = storagePath.split("/").slice(0, -1).join("/");
  const name = storagePath.split("/").pop();
  try {
    const { data, error } = await withTimeout(
      supabase.storage.from(STORAGE_BUCKET).list(folder, { search: name }),
      `list ${folder}`
    );
    if (error) return false;
    return !!(data && data.some((f) => f.name === name));
  } catch (err) {
    console.error(`Storage existence check failed for ${storagePath}:`, err);
    return false;
  }
}

/** Returns a short-lived signed URL for reading a private object. */
async function getSignedUrl(storagePath, expiresInSeconds) {
  const { data, error } = await withTimeout(
    supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, expiresInSeconds),
    `sign ${storagePath}`
  );
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Uploads a small image already held in memory (course thumbnails only
 * — a few hundred KB to a few MB, never large enough to need the
 * temp-file streaming path uploadFile() above uses for videos) to the
 * PUBLIC thumbnail bucket, then returns its permanent public URL. Uses
 * `upsert: true` because a thumbnail replacement re-uses the same
 * storagePath (the course's id-derived path) rather than growing a new
 * object per edit.
 */
async function uploadPublicImage(buffer, storagePath, contentType) {
  const { error } = await withTimeout(
    supabase.storage.from(THUMBNAIL_BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    }),
    `upload ${storagePath}`
  );
  if (error) throw error;
  const { data } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/** Best-effort delete of a thumbnail object; never throws. */
async function deleteThumbnailSafely(storagePath) {
  if (!storagePath) return { ok: true };
  try {
    const { error } = await withTimeout(
      supabase.storage.from(THUMBNAIL_BUCKET).remove([storagePath]),
      `delete thumbnail ${storagePath}`
    );
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    console.error(`Failed to delete thumbnail ${storagePath}:`, err);
    return { ok: false, error: err };
  }
}

/**
 * Recursively walks every object under `prefix` (default: the whole
 * bucket). Storage's list() only returns one directory level at a time
 * and represents sub-folders as entries with `id: null`, so this walks
 * down until it hits real objects (which always have an `id`). Used by
 * the orphan-file cleanup job (spec #5E) — the storage layout here is
 * shallow (`courses/{courseId}/{folder}/{contentId}/{file}`) and admin
 * counts are small, so a full recursive walk is an acceptable cost for
 * a scheduled background job.
 */
async function listAllObjects(prefix = "") {
  const results = [];
  async function walk(folder) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(folder, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    for (const entry of data || []) {
      const fullPath = folder ? `${folder}/${entry.name}` : entry.name;
      const isFolder = entry.id === null || entry.id === undefined;
      if (isFolder) {
        await walk(fullPath);
      } else {
        results.push({ path: fullPath, createdAt: entry.created_at, updatedAt: entry.updated_at, sizeBytes: entry.metadata?.size ?? null });
      }
    }
  }
  await walk(prefix);
  return results;
}

module.exports = { uploadFile, deleteFileSafely, fileExists, getSignedUrl, listAllObjects, uploadPublicImage, deleteThumbnailSafely, THUMBNAIL_BUCKET };
