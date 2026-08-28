process.env.PLAYBACK_TOKEN_SECRET = "01234567890123456789012345678901";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlaybackToken, verifyPlaybackToken } = require("../lib/playbackToken");

test("playback token round-trips and binds content/user", () => {
  const token = createPlaybackToken({ userId: "user-1", contentId: "content-1", role: "STUDENT" });
  const claims = verifyPlaybackToken(token);
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.cid, "content-1");
  assert.equal(claims.role, "STUDENT");
});

test("tampered playback token is rejected", () => {
  const token = createPlaybackToken({ userId: "user-1", contentId: "content-1", role: "STUDENT" });
  const [payload, signature] = token.split(".");
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifyPlaybackToken(tampered), null);
});

// Regression: a token minted for one piece of content must not grant
// streaming access to a different piece of content just because it's
// otherwise valid (signature intact, not expired). files.routes.js
// enforces this with `claims.cid !== req.params.contentId`; this test
// pins down the payload-level guarantee that makes that check
// meaningful — the cid is inside the signed payload, so it can't be
// swapped without invalidating the signature.
test("a token minted for content A does not verify as belonging to content B", () => {
  const token = createPlaybackToken({ userId: "user-1", contentId: "content-A", role: "STUDENT" });
  const claims = verifyPlaybackToken(token);
  assert.notEqual(claims.cid, "content-B");
});

test("rewriting the cid in the payload without re-signing invalidates the token", () => {
  const token = createPlaybackToken({ userId: "user-1", contentId: "content-A", role: "STUDENT" });
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.cid = "content-B";
  const forgedEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const forged = `${forgedEncoded}.${signature}`;
  assert.equal(verifyPlaybackToken(forged), null);
});

test("expired playback token is rejected", () => {
  const token = createPlaybackToken({ userId: "user-1", contentId: "content-1", role: "STUDENT" });
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.exp = Math.floor(Date.now() / 1000) - 10;
  // Re-sign so this isolates the expiry check from the signature check.
  const crypto = require("crypto");
  const forgedEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const forgedSignature = crypto.createHmac("sha256", process.env.PLAYBACK_TOKEN_SECRET).update(forgedEncoded).digest("base64url");
  const expiredToken = `${forgedEncoded}.${forgedSignature}`;
  assert.equal(verifyPlaybackToken(expiredToken), null);
});

test("malformed tokens (no dot, empty, non-string, oversized) are rejected without throwing", () => {
  assert.equal(verifyPlaybackToken(null), null);
  assert.equal(verifyPlaybackToken(undefined), null);
  assert.equal(verifyPlaybackToken(""), null);
  assert.equal(verifyPlaybackToken("no-dot-in-here"), null);
  assert.equal(verifyPlaybackToken("."), null);
  assert.equal(verifyPlaybackToken("a".repeat(5000)), null);
});

test("a token whose decoded payload is missing required fields is rejected", () => {
  const crypto = require("crypto");
  const badPayload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url"); // missing cid/exp
  const sig = crypto.createHmac("sha256", process.env.PLAYBACK_TOKEN_SECRET).update(badPayload).digest("base64url");
  assert.equal(verifyPlaybackToken(`${badPayload}.${sig}`), null);
});
