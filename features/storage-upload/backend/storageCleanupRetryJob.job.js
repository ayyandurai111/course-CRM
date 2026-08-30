const cron = require("node-cron");
const { retryQueuedStorageCleanup } = require("./storageCleanupQueueService");

/**
 * Runs every 10 minutes and retries any Storage object deletion queued
 * in storage_cleanup_queue (spec #9) that didn't complete immediately —
 * by delete_course_cascade() (course delete) or delete_content_cascade()
 * (single content delete) — e.g. a Storage outage during deletion, or a
 * process restart between the DB transaction committing and the
 * follow-up delete calls running. Idempotent and safe to overlap with
 * itself or with a concurrent deletion.
 */
function startStorageCleanupRetryJob() {
  cron.schedule("*/10 * * * *", async () => {
    try {
      const summary = await retryQueuedStorageCleanup();
      if (summary.scanned > 0) {
        console.log("[scheduler] Storage cleanup queue retry finished:", summary);
      }
    } catch (err) {
      console.error("[scheduler] Storage cleanup queue retry failed:", err);
    }
  });
  console.log("[scheduler] Storage cleanup queue retry job started (runs every 10 minutes).");
}

module.exports = { startStorageCleanupRetryJob };
