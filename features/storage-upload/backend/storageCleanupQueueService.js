const { supabase, rows, assertNoError } = require("../../../shared/backend-core/db");
const { deleteFileSafely } = require("./storage.lib");

const DEFAULT_BATCH_SIZE = 200;
const MAX_ATTEMPTS = 10;

/**
 * Retries every PENDING/FAILED row in storage_cleanup_queue (populated
 * by delete_course_cascade() — see supabase/schema.sql — whenever a
 * course delete's immediate best-effort Storage cleanup in
 * courses.routes.js didn't finish, e.g. a Storage outage or a process
 * crash between the DB commit and the delete calls). Safe to run
 * repeatedly/concurrently: deleting an already-deleted object is not an
 * error (see deleteFileSafely), and each row is only ever moved forward
 * (PENDING/FAILED -> DONE), never re-queued once DONE.
 */
async function retryQueuedStorageCleanup({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const { data, error } = await supabase
    .from("storage_cleanup_queue")
    .select("*")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(batchSize);
  assertNoError(error, "Failed to load storage cleanup queue");

  const items = rows(data);
  const summary = { scanned: items.length, deleted: 0, stillFailed: 0 };

  for (const item of items) {
    const result = await deleteFileSafely(item.fileKey);
    if (result.ok) {
      summary.deleted += 1;
      await supabase.from("storage_cleanup_queue").update({ status: "DONE", updated_at: new Date() }).eq("id", item.id);
    } else {
      summary.stillFailed += 1;
      await supabase
        .from("storage_cleanup_queue")
        .update({
          status: "FAILED",
          attempts: (item.attempts || 0) + 1,
          last_error: String(result.error?.message || result.error || "unknown error"),
          updated_at: new Date(),
        })
        .eq("id", item.id);
    }
  }

  return summary;
}

module.exports = { retryQueuedStorageCleanup, MAX_ATTEMPTS };
