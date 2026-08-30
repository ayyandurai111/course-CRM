const { supabase, rows, assertNoError } = require("../../../shared/backend-core/db");
const { listAllObjects, deleteFileSafely } = require("./storage.lib");

const DEFAULT_MIN_AGE_HOURS = 24;

/**
 * Finds Storage objects under `courses/` that no `content` row
 * references (spec #5E) and deletes only objects proven to be orphaned:
 *
 *   - never deletes an object younger than `minAgeHours` (spec #5E/#5F —
 *     an upload/database workflow may still be in progress), and
 *   - never deletes an object whose path matches some row's file_key,
 *     even if that row is a draft, unpublished, or otherwise not "live"
 *     (spec #5F — only proven-orphan objects are touched).
 *
 * Safe to re-run: an object already deleted simply won't appear in the
 * next scan (spec verification #11, idempotent).
 */
async function findAndDeleteOrphanFiles({ minAgeHours = DEFAULT_MIN_AGE_HOURS, dryRun = false } = {}) {
  const objects = await listAllObjects("courses");

  const { data: contentRows, error } = await supabase.from("content").select("file_key").not("file_key", "is", null);
  assertNoError(error, "Failed to load content file keys for orphan scan");
  const referencedKeys = new Set(rows(contentRows).map((r) => r.fileKey));

  const cutoffMs = Date.now() - minAgeHours * 60 * 60 * 1000;
  const summary = { scanned: objects.length, deleted: 0, deleteFailed: 0, protectedCount: 0, tooRecent: 0 };

  for (const obj of objects) {
    if (referencedKeys.has(obj.path)) {
      summary.protectedCount += 1;
      continue;
    }

    const createdAtMs = obj.createdAt ? new Date(obj.createdAt).getTime() : null;
    // No/unparseable timestamp is treated as "too recent to trust" —
    // never delete something we can't confidently age-check.
    if (!createdAtMs || createdAtMs > cutoffMs) {
      summary.tooRecent += 1;
      continue;
    }

    if (dryRun) {
      summary.deleted += 1;
      continue;
    }

    const result = await deleteFileSafely(obj.path);
    console.log("[orphanCleanup]", {
      fileKey: obj.path,
      reason: "no referencing content.file_key",
      ageHours: Math.round((Date.now() - createdAtMs) / (60 * 60 * 1000)),
      success: result.ok,
      timestamp: new Date().toISOString(),
    });
    if (result.ok) summary.deleted += 1;
    else summary.deleteFailed += 1;
  }

  return summary;
}

module.exports = { findAndDeleteOrphanFiles, DEFAULT_MIN_AGE_HOURS };
