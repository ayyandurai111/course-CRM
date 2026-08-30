const fs = require("fs");
const os = require("os");
const path = require("path");

// Matches the temp filenames generated in upload.routes.js's
// multer.diskStorage `filename` callback.
const TEMP_FILE_PREFIX = "upload-";
const DEFAULT_STALE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Deletes any leftover `upload-*` temp files in the OS temp dir older
 * than `staleAgeMs` (spec #3F). Under normal operation every upload
 * temp file is removed in the route handler's own finally block (or by
 * the uploadGate's abort handler), so this is a safety net for the
 * cases those miss — e.g. a hard process crash/restart mid-upload.
 */
async function cleanupStaleTempFiles(staleAgeMs = DEFAULT_STALE_AGE_MS) {
  const dir = os.tmpdir();
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch (err) {
    console.error("[tempFileCleanup] Failed to read temp dir:", err);
    return { scanned: 0, deleted: 0 };
  }

  const now = Date.now();
  let deleted = 0;
  let scanned = 0;

  for (const name of entries) {
    if (!name.startsWith(TEMP_FILE_PREFIX)) continue;
    scanned += 1;
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > staleAgeMs) {
        await fs.promises.unlink(fullPath);
        deleted += 1;
      }
    } catch (err) {
      // File may have been removed by the normal upload cleanup path
      // between readdir() and stat()/unlink() — not an error.
      if (err.code !== "ENOENT") {
        console.error(`[tempFileCleanup] Failed to check/delete ${fullPath}:`, err);
      }
    }
  }

  return { scanned, deleted };
}

/** Runs once at startup and then every 30 minutes. */
function startTempFileCleanup() {
  const staleAgeMs = Number(process.env.STALE_TEMP_FILE_MAX_AGE_MS) || DEFAULT_STALE_AGE_MS;

  cleanupStaleTempFiles(staleAgeMs)
    .then(({ scanned, deleted }) => {
      if (deleted > 0) console.log(`[tempFileCleanup] Startup sweep: removed ${deleted}/${scanned} stale upload temp file(s).`);
    })
    .catch((err) => console.error("[tempFileCleanup] Startup sweep failed:", err));

  setInterval(() => {
    cleanupStaleTempFiles(staleAgeMs)
      .then(({ scanned, deleted }) => {
        if (deleted > 0) console.log(`[tempFileCleanup] Periodic sweep: removed ${deleted}/${scanned} stale upload temp file(s).`);
      })
      .catch((err) => console.error("[tempFileCleanup] Periodic sweep failed:", err));
  }, 30 * 60 * 1000).unref();

  console.log(`[tempFileCleanup] Stale temp-file cleanup started (max age ${staleAgeMs}ms).`);
}

module.exports = { startTempFileCleanup, cleanupStaleTempFiles };
