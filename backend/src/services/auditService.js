const { supabase, toSnake } = require("../lib/db");

const SENSITIVE_KEY = /(password|passcode|secret|token|authorization|cookie|service.?role|api.?key|access.?token|refresh.?token)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 1000;
const MAX_KEYS = 50;

function sanitizeAuditValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => sanitizeAuditValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value).slice(0, MAX_KEYS)) {
      if (SENSITIVE_KEY.test(key)) { out[key] = "[redacted]"; continue; }
      out[key] = sanitizeAuditValue(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Records a critical admin action. Never blocks the main operation on failure. */
async function logAction({ actorId, action, entityType, entityId, metadata }) {
  try {
    const safeMetadata = metadata == null ? null : sanitizeAuditValue(metadata);
    const { error } = await supabase.from("audit_logs").insert(
      toSnake({ actorId, action, entityType, entityId, metadata: safeMetadata })
    );
    if (error) throw error;
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

module.exports = { logAction, sanitizeAuditValue };
