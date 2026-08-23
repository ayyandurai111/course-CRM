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
