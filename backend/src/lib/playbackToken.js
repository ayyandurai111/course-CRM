const crypto = require("crypto");

const PLAYBACK_TOKEN_TTL_SECONDS = Math.min(
  15 * 60,
  Math.max(60, Number(process.env.PLAYBACK_TOKEN_TTL_SECONDS) || 10 * 60)
);

function getSecret() {
  const secret = process.env.PLAYBACK_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PLAYBACK_TOKEN_SECRET must be set and at least 32 characters long.");
  }
  return secret;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function createPlaybackToken({ userId, contentId, role }) {
  const payload = {
    sub: String(userId),
    cid: String(contentId),
    role: String(role || "STUDENT"),
    exp: Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(12).toString("base64url"),
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifyPlaybackToken(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(encoded);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.sub || !payload?.cid || !Number.isInteger(payload.exp)) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { createPlaybackToken, verifyPlaybackToken, PLAYBACK_TOKEN_TTL_SECONDS };
