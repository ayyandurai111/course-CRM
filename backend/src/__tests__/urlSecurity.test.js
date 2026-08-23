const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedHttpsImageUrl } = require("../lib/urlSecurity");

test("image URL allowlist rejects arbitrary HTTPS origins by default", () => {
  const old = process.env.ALLOWED_IMAGE_ORIGINS;
  delete process.env.ALLOWED_IMAGE_ORIGINS;
  assert.equal(isAllowedHttpsImageUrl("https://evil.example/a.png"), false);
  process.env.ALLOWED_IMAGE_ORIGINS = old;
});

test("image URL allowlist accepts only configured HTTPS origins", () => {
  const old = process.env.ALLOWED_IMAGE_ORIGINS;
  process.env.ALLOWED_IMAGE_ORIGINS = "https://images.example.com";
  assert.equal(isAllowedHttpsImageUrl("https://images.example.com/a.png"), true);
  assert.equal(isAllowedHttpsImageUrl("https://evil.example/a.png"), false);
  assert.equal(isAllowedHttpsImageUrl("http://images.example.com/a.png"), false);
  process.env.ALLOWED_IMAGE_ORIGINS = old;
});
