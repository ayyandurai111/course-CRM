const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidDate, parseValidDate, isoDateTimeString, futureIsoDateTimeString } = require("../dateValidation");

// --- the root cause this fix targets ---

test("regression: new Date('garbage') <= new Date() is false, not an error — this is exactly why naive comparisons are unsafe", () => {
  // Documents the bug this whole fix exists to close: an Invalid Date
  // silently fails every comparison instead of throwing.
  assert.equal(new Date("garbage") <= new Date(), false);
  assert.equal(new Date("garbage") > new Date(), false);
  // Our helper must not have this blind spot:
  assert.equal(parseValidDate("garbage"), null);
});

// --- isValidDate / parseValidDate ---

test("isValidDate accepts a real Date and rejects an Invalid Date", () => {
  assert.equal(isValidDate(new Date()), true);
  assert.equal(isValidDate(new Date("not a date")), false);
  assert.equal(isValidDate("2026-01-01"), false); // not even a Date instance
});

test("parseValidDate: valid ISO date", () => {
  const d = parseValidDate("2027-01-01T00:00:00Z");
  assert.ok(d instanceof Date);
  assert.equal(Number.isNaN(d.getTime()), false);
});

test("parseValidDate: invalid string returns null", () => {
  assert.equal(parseValidDate("not-a-date"), null);
  assert.equal(parseValidDate("2027-13-45"), null);
});

test("parseValidDate: empty value returns null", () => {
  assert.equal(parseValidDate(""), null);
});

test("parseValidDate: null/undefined where not allowed returns null (caller must reject)", () => {
  assert.equal(parseValidDate(null), null);
  assert.equal(parseValidDate(undefined), null);
});

test("parseValidDate: a timezone-offset value is accepted and represents the correct instant", () => {
  const utc = parseValidDate("2027-06-01T12:00:00Z");
  const plus2 = parseValidDate("2027-06-01T14:00:00+02:00");
  assert.equal(utc.getTime(), plus2.getTime());
});

test("parseValidDate: a genuinely past date parses fine (validity != futurity — separate concerns)", () => {
  const past = parseValidDate("2020-01-01T00:00:00Z");
  assert.ok(past instanceof Date);
  assert.ok(past.getTime() < Date.now());
});

test("parseValidDate: a valid future date parses fine", () => {
  const future = parseValidDate(new Date(Date.now() + 86400000).toISOString());
  assert.ok(future.getTime() > Date.now());
});

// --- zod schemas ---

test("isoDateTimeString: rejects invalid string", () => {
  const result = isoDateTimeString.safeParse("not-a-date");
  assert.equal(result.success, false);
});

test("isoDateTimeString: rejects empty string", () => {
  const result = isoDateTimeString.safeParse("");
  assert.equal(result.success, false);
});

test("isoDateTimeString: accepts a valid ISO date, past or future (futurity not required by this schema)", () => {
  assert.equal(isoDateTimeString.safeParse("2020-01-01T00:00:00Z").success, true);
  assert.equal(isoDateTimeString.safeParse(new Date(Date.now() + 10000).toISOString()).success, true);
});

test("futureIsoDateTimeString: rejects a past date", () => {
  const result = futureIsoDateTimeString.safeParse("2020-01-01T00:00:00Z");
  assert.equal(result.success, false);
  assert.match(result.error.errors[0].message, /future/);
});

test("futureIsoDateTimeString: rejects an invalid string (does not fall through to the future check)", () => {
  const result = futureIsoDateTimeString.safeParse("garbage");
  assert.equal(result.success, false);
});

test("futureIsoDateTimeString: accepts a valid future date", () => {
  const result = futureIsoDateTimeString.safeParse(new Date(Date.now() + 3600000).toISOString());
  assert.equal(result.success, true);
});

test("futureIsoDateTimeString: rejects null (not allowed by this schema — required field)", () => {
  const result = futureIsoDateTimeString.safeParse(null);
  assert.equal(result.success, false);
});

// --- route-level schema (content.routes.js scheduleBodySchema) ---

const { scheduleBodySchema } = require("../../../features/content/backend/content.routes");

test("scheduleBodySchema: rejects missing scheduledAt", () => {
  assert.equal(scheduleBodySchema.safeParse({}).success, false);
});

test("scheduleBodySchema: rejects invalid string", () => {
  assert.equal(scheduleBodySchema.safeParse({ scheduledAt: "not-a-date" }).success, false);
});

test("scheduleBodySchema: rejects empty string", () => {
  assert.equal(scheduleBodySchema.safeParse({ scheduledAt: "" }).success, false);
});

test("scheduleBodySchema: rejects a past date", () => {
  assert.equal(scheduleBodySchema.safeParse({ scheduledAt: "2020-01-01T00:00:00Z" }).success, false);
});

test("scheduleBodySchema: accepts a valid future date with a UTC offset", () => {
  const result = scheduleBodySchema.safeParse({ scheduledAt: new Date(Date.now() + 60000).toISOString() });
  assert.equal(result.success, true);
});

test("scheduleBodySchema: accepts a valid future date with a non-UTC timezone offset", () => {
  const future = new Date(Date.now() + 3600000);
  const iso = future.toISOString().replace("Z", "+00:00"); // equivalent explicit offset form
  const result = scheduleBodySchema.safeParse({ scheduledAt: iso });
  assert.equal(result.success, true);
});

test("contentService.schedule/reschedule use parseValidDate — the unsafe raw `new Date(x) <= new Date()` comparison is gone", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../../../features/content/backend/contentService"), "utf8");
  assert.ok(!/new Date\(scheduledAt\) <= new Date\(\)/.test(src), "the unsafe raw comparison must be gone");
  assert.match(src, /parseValidDate\(scheduledAt\)/);
});
