const cron = require("node-cron");
const { retryPendingUserDeletions } = require("./userDeletionService");

/**
 * Runs every 10 minutes and retries the Supabase Auth deletion for any
 * student whose profile row is still `pending_deletion = true` (the
 * Auth-side deletion in beginStudentDeletion() didn't succeed
 * immediately — e.g. a transient Supabase Auth outage). The profile row
 * stays inactive and un-recreatable the whole time it's pending — see
 * services/userDeletionService.js for the full ordering rationale
 * behind why this closes the "deleted user recreation" bug.
 */
function startUserDeletionRetryJob() {
  cron.schedule("*/10 * * * *", async () => {
    try {
      const summary = await retryPendingUserDeletions();
      if (summary.scanned > 0) {
        console.log("[scheduler] Pending user deletion retry finished:", summary);
      }
    } catch (err) {
      console.error("[scheduler] Pending user deletion retry failed:", err);
    }
  });
  console.log("[scheduler] Pending user deletion retry job started (runs every 10 minutes).");
}

module.exports = { startUserDeletionRetryJob };
