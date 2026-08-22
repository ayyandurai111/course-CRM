const cron = require("node-cron");
const { publishDueScheduledContent } = require("../services/contentService");

/**
 * Runs every minute and flips any SCHEDULED content whose scheduledAt
 * has passed to PUBLISHED. The underlying batch write is idempotent, so
 * overlapping runs or restarts are safe.
 */
function startPublishScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      const { publishedCount } = await publishDueScheduledContent();
      if (publishedCount > 0) {
        console.log(`[scheduler] Published ${publishedCount} scheduled content item(s).`);
      }
    } catch (err) {
      console.error("[scheduler] Failed to publish due content:", err);
    }
  });
  console.log("[scheduler] Publish scheduler started (runs every minute).");
}

module.exports = { startPublishScheduler };
