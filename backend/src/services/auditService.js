const { supabase, toSnake } = require("../lib/db");

/** Records a critical admin action. Never blocks the main operation on failure. */
async function logAction({ actorId, action, entityType, entityId, metadata }) {
  try {
    const { error } = await supabase.from("audit_logs").insert(
      toSnake({
        actorId,
        action,
        entityType,
        entityId,
        metadata: metadata || null,
      })
    );
    if (error) throw error;
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

module.exports = { logAction };
