const test = require("node:test");
const assert = require("node:assert/strict");
const { computeServerProgress } = require("../routes/content.routes");

// --- VIDEO: progressPercent alone (no position) must never be trusted ---

test("VIDEO: progressPercent:100 with no lastPositionSeconds is rejected outright", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 600, progressPercent: 100, lastPositionSeconds: undefined });
  assert.equal(result.ok, false);
  assert.match(result.error, /lastPositionSeconds is required/);
});

test("VIDEO: a valid lastPositionSeconds derives progressPercent from position, ignoring any client progressPercent", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 200, progressPercent: 1, lastPositionSeconds: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 50); // 100/200, NOT the client's claimed "1"
  assert.equal(result.lastPositionSeconds, 100);
});

test("VIDEO: negative position is rejected", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 200, lastPositionSeconds: -5 });
  assert.equal(result.ok, false);
  assert.match(result.error, /must not be negative/);
});

test("VIDEO: a position far beyond duration is rejected (not silently clamped)", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 200, lastPositionSeconds: 999999 });
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds the content's duration/);
});

test("VIDEO: a position slightly beyond duration (player rounding) is tolerated and clamped to 100%", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 200, lastPositionSeconds: 203 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 100);
  assert.equal(result.lastPositionSeconds, 200);
});

test("VIDEO: normal partial progress is computed correctly and clamped 0-100", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 400, lastPositionSeconds: 40 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 10);
});

test("VIDEO: full valid completion (position === duration) yields 100%", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 300, lastPositionSeconds: 300 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 100);
});

test("VIDEO: resume still works when duration is not yet known — position is saved, percent is not fabricated", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: null, lastPositionSeconds: 42, progressPercent: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.lastPositionSeconds, 42); // saved for resume
  assert.equal(result.progressPercent, undefined); // never fabricated from the client's claim
});

test("VIDEO: duration of 0 is treated as unknown, not a divide-by-zero", () => {
  const result = computeServerProgress({ type: "VIDEO", duration: 0, lastPositionSeconds: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, undefined);
});

// --- PDF / POST: unaffected, still trust the client's own declared percent ---

test("PDF: a client-declared progressPercent is trusted as before (no position concept for PDFs)", () => {
  const result = computeServerProgress({ type: "PDF", duration: null, progressPercent: 100, lastPositionSeconds: undefined });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 100);
});

test("POST: a client-declared progressPercent is trusted as before", () => {
  const result = computeServerProgress({ type: "POST", duration: null, progressPercent: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.progressPercent, 50);
});
