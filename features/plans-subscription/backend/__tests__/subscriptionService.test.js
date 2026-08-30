const test = require("node:test");
const assert = require("node:assert/strict");
const { isSubscriptionUsable } = require("../subscriptionService");

test("no subscription is never usable", () => {
  assert.equal(isSubscriptionUsable(null), false);
  assert.equal(isSubscriptionUsable(undefined), false);
});

test("CANCELLED or EXPIRED status is never usable regardless of expiresAt", () => {
  assert.equal(isSubscriptionUsable({ status: "CANCELLED", expiresAt: new Date(Date.now() + 100000).toISOString() }), false);
  assert.equal(isSubscriptionUsable({ status: "EXPIRED", expiresAt: new Date(Date.now() + 100000).toISOString() }), false);
});

test("ACTIVE with no expiresAt (lifetime plan) is usable", () => {
  assert.equal(isSubscriptionUsable({ status: "ACTIVE", expiresAt: null }), true);
});

test("ACTIVE with a future expiresAt is usable", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(isSubscriptionUsable({ status: "ACTIVE", expiresAt: future }), true);
});

test("ACTIVE with a past expiresAt is NOT usable, even though status is still ACTIVE", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(isSubscriptionUsable({ status: "ACTIVE", expiresAt: past }), false);
});

test("ACTIVE with expiresAt exactly now is NOT usable", () => {
  const now = new Date(Date.now() - 1).toISOString();
  assert.equal(isSubscriptionUsable({ status: "ACTIVE", expiresAt: now }), false);
});
