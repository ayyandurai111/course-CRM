const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTransition, InvalidTransitionError, TRANSITIONS } = require("../services/contentService");

test("DRAFT can move to SCHEDULED, PUBLISHED, or ARCHIVED", () => {
  assert.doesNotThrow(() => assertTransition("DRAFT", "SCHEDULED"));
  assert.doesNotThrow(() => assertTransition("DRAFT", "PUBLISHED"));
  assert.doesNotThrow(() => assertTransition("DRAFT", "ARCHIVED"));
});

test("PUBLISHED cannot go directly back to DRAFT", () => {
  assert.throws(() => assertTransition("PUBLISHED", "DRAFT"), InvalidTransitionError);
});

test("ARCHIVED is terminal — no transitions allowed out of it", () => {
  assert.equal(TRANSITIONS.ARCHIVED.length, 0);
  assert.throws(() => assertTransition("ARCHIVED", "PUBLISHED"), InvalidTransitionError);
  assert.throws(() => assertTransition("ARCHIVED", "DRAFT"), InvalidTransitionError);
});

test("UNPUBLISHED content can be republished or rescheduled", () => {
  assert.doesNotThrow(() => assertTransition("UNPUBLISHED", "PUBLISHED"));
  assert.doesNotThrow(() => assertTransition("UNPUBLISHED", "SCHEDULED"));
});

test("SCHEDULED content cannot skip straight to UNPUBLISHED", () => {
  assert.throws(() => assertTransition("SCHEDULED", "UNPUBLISHED"), InvalidTransitionError);
});
