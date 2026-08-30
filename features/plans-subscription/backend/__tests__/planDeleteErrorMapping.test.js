const test = require("node:test");
const assert = require("node:assert/strict");
const { mapPlanDeleteError } = require("../plans.routes");

test("a foreign-key violation (plan still has subscription history) maps to a clean 409", () => {
  const pgError = { code: "23503", message: 'update or delete on table "plans" violates foreign key constraint "subscriptions_plan_id_fkey" on table "subscriptions"' };
  const mapped = mapPlanDeleteError(pgError);
  assert.ok(mapped);
  assert.equal(mapped.status, 409);
  assert.match(mapped.body.error, /deactivate/i);
  // The raw Postgres constraint/table names must not leak to the client.
  assert.ok(!mapped.body.error.includes("subscriptions_plan_id_fkey"));
});

test("no error, or an unrelated error, is not special-cased", () => {
  assert.equal(mapPlanDeleteError(null), null);
  assert.equal(mapPlanDeleteError({ code: "23505", message: "unique violation" }), null);
});
