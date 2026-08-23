const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeAuditValue } = require("../services/auditService");

test("audit metadata redacts secrets and bounds strings", () => {
  const result = sanitizeAuditValue({ token: "secret", password: "pw", note: "x".repeat(2000) });
  assert.equal(result.token, "[redacted]");
  assert.equal(result.password, "[redacted]");
  assert.ok(result.note.length < 1100);
});
