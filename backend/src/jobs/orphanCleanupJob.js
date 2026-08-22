const cron = require("node-cron");
const { findAndDeleteOrphanFiles, DEFAULT_MIN_AGE_HOURS } = require("../services/orphanCleanupService");

/**
 * Runs once a day and deletes Storage objects under `courses/` that no
 * `content` row references and that are older than
 * ORPHAN_FILE_MIN_AGE_HOURS (spec #5E). Idempotent and safe to overlap
 * with an in-flight upload/content-creation workflow, since anything
 * younger than the age threshold is always skipped.
 */
function startOrphanCleanupJob() {
  const minAgeHours = Number(process.env.ORPHAN_FILE_MIN_AGE_HOURS) || DEFAULT_MIN_AGE_HOURS;

  cron.schedule("0 3 * * *", async () => {
    try {
      const summary = await findAndDeleteOrphanFiles({ minAgeHours });
      console.log("[scheduler] Orphan Storage cleanup finished:", summary);
    } catch (err) {
      console.error("[scheduler] Orphan Storage cleanup failed:", err);
    }
  });
  console.log(`[scheduler] Orphan Storage cleanup job started (runs daily, min age ${minAgeHours}h).`);
}

module.exports = { startOrphanCleanupJob };
