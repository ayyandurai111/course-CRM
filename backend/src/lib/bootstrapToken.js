const crypto = require("crypto");

/**
 * Constant-time check of the x-bootstrap-token header (auth.routes.js
 * POST /bootstrap-admin) against the server-only ADMIN_BOOTSTRAP_TOKEN
 * env var. Using === here would leak timing information an attacker
 * could use to guess the token byte-by-byte; crypto.timingSafeEqual
 * avoids that, but only for equal-length buffers, so a length mismatch
 * is handled as its own branch (with a dummy compare of matching cost)
 * rather than falling through to timingSafeEqual, which throws on
 * mismatched lengths.
 *
 * Returns false (never throws) for any malformed/missing input,
 * including when ADMIN_BOOTSTRAP_TOKEN itself isn't configured — which
 * is what keeps the bootstrap endpoint disabled by default.
 */
function isValidBootstrapToken(suppliedToken, configuredToken) {
  if (typeof configuredToken !== "string" || configuredToken.length === 0) return false;
  if (typeof suppliedToken !== "string" || suppliedToken.length === 0) return false;

  const suppliedBuf = Buffer.from(suppliedToken, "utf8");
  const configuredBuf = Buffer.from(configuredToken, "utf8");

  if (suppliedBuf.length !== configuredBuf.length) {
    crypto.timingSafeEqual(configuredBuf, configuredBuf); // keep timing consistent
    return false;
  }
  return crypto.timingSafeEqual(suppliedBuf, configuredBuf);
}

module.exports = { isValidBootstrapToken };
