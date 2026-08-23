const test = require("node:test");
const assert = require("node:assert/strict");

// uploadGate keeps module-level state, so each test resets it via
// _resetForTests() to avoid leaking counters between tests.
const uploadGate = require("../lib/uploadGate");

test("tryAcquireUploadSlot enforces MAX_CONCURRENT_UPLOADS regardless of size", () => {
  uploadGate._resetForTests();
  const slots = [];
  for (let i = 0; i < uploadGate.MAX_CONCURRENT_UPLOADS; i++) {
    const s = uploadGate.tryAcquireUploadSlot();
    assert.equal(s.ok, true);
    slots.push(s);
  }
  const overflow = uploadGate.tryAcquireUploadSlot();
  assert.equal(overflow.ok, false);
  assert.match(overflow.reason, /Too many uploads/);

  uploadGate.releaseUploadSlot();
  const afterRelease = uploadGate.tryAcquireUploadSlot();
  assert.equal(afterRelease.ok, true);
});

test("tryReserveBytes accounts live bytes and rejects once the pool is full — independent of any Content-Length claim", () => {
  uploadGate._resetForTests();
  const cap = uploadGate.MAX_TEMP_STORAGE_BYTES;

  // Simulate a "chunked" upload (no declared size at all) writing bytes
  // in small increments, as the metered storage engine does per chunk.
  const chunk = Math.floor(cap / 4);
  assert.equal(uploadGate.tryReserveBytes(chunk), true);
  assert.equal(uploadGate.tryReserveBytes(chunk), true);
  assert.equal(uploadGate.tryReserveBytes(chunk), true);
  assert.equal(uploadGate.tryReserveBytes(chunk), true); // now at cap exactly
  // One more byte must be rejected — the pool has no notion of
  // Content-Length, only what has actually been reserved so far.
  assert.equal(uploadGate.tryReserveBytes(1), false);

  assert.equal(uploadGate.getUploadGateStats().reservedBytes, chunk * 4);
});

test("multiple concurrent chunked (unknown-size) uploads cannot together exceed MAX_TEMP_STORAGE_BYTES", () => {
  uploadGate._resetForTests();
  const cap = uploadGate.MAX_TEMP_STORAGE_BYTES;
  const perUploadChunk = Math.floor(cap / 3) + 1; // 3 of these exceed the cap

  assert.equal(uploadGate.tryReserveBytes(perUploadChunk), true); // upload A
  assert.equal(uploadGate.tryReserveBytes(perUploadChunk), true); // upload B
  assert.equal(uploadGate.tryReserveBytes(perUploadChunk), false); // upload C rejected — pool protected
  assert.ok(uploadGate.getUploadGateStats().reservedBytes <= cap);
});

test("releaseBytes returns reserved capacity so a later upload can proceed", () => {
  uploadGate._resetForTests();
  const cap = uploadGate.MAX_TEMP_STORAGE_BYTES;
  assert.equal(uploadGate.tryReserveBytes(cap), true);
  assert.equal(uploadGate.tryReserveBytes(1), false);

  uploadGate.releaseBytes(cap);
  assert.equal(uploadGate.getUploadGateStats().reservedBytes, 0);
  assert.equal(uploadGate.tryReserveBytes(cap), true);
});

test("releaseUploadSlot and releaseBytes never underflow below zero", () => {
  uploadGate._resetForTests();
  uploadGate.releaseUploadSlot();
  uploadGate.releaseUploadSlot();
  uploadGate.releaseBytes(100);
  const stats = uploadGate.getUploadGateStats();
  assert.equal(stats.activeCount, 0);
  assert.equal(stats.reservedBytes, 0);
});
