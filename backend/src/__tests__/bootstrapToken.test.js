const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidBootstrapToken } = require("../lib/bootstrapToken");

test("accepts a supplied token that matches the configured token", () => {
  assert.equal(isValidBootstrapToken("correct-horse-battery-staple", "correct-horse-battery-staple"), true);
});

test("rejects a wrong token of the same length", () => {
  assert.equal(isValidBootstrapToken("correct-horse-battery-staplf", "correct-horse-battery-staple"), false);
});

test("rejects a wrong token of a different length", () => {
  assert.equal(isValidBootstrapToken("short", "correct-horse-battery-staple"), false);
});

test("rejects any token when no ADMIN_BOOTSTRAP_TOKEN is configured (feature off by default)", () => {
  assert.equal(isValidBootstrapToken("anything", ""), false);
  assert.equal(isValidBootstrapToken("anything", undefined), false);
});

test("rejects when no token is supplied on the request", () => {
  assert.equal(isValidBootstrapToken("", "correct-horse-battery-staple"), false);
  assert.equal(isValidBootstrapToken(undefined, "correct-horse-battery-staple"), false);
});

test("does not throw on non-string header values (e.g. an array from a duplicated header)", () => {
  assert.equal(isValidBootstrapToken(["a", "b"], "correct-horse-battery-staple"), false);
});
