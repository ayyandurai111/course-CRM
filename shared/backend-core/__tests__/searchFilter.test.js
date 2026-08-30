const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeForIlike, containsPattern } = require("../searchFilter");

test("plain alphanumeric search terms pass through untouched", () => {
  assert.equal(escapeForIlike("jane doe"), "jane doe");
  assert.equal(containsPattern("jane"), "%jane%");
});

test("ILIKE wildcard characters are escaped so they match literally", () => {
  assert.equal(escapeForIlike("50%"), "50\\%");
  assert.equal(escapeForIlike("a_b"), "a\\_b");
});

test("PostgREST .or() filter delimiters are escaped, preventing filter injection", () => {
  // Without escaping, a search value containing `,` could terminate the
  // current ilike clause and start a brand-new filter clause inside the
  // `.or("name.ilike.<value>,email.ilike.<value>")` string built in
  // students.routes.js — e.g. smuggling in `role.eq.ADMIN` as an
  // independent OR condition.
  const malicious = "x,role.eq.ADMIN";
  const escaped = escapeForIlike(malicious);
  assert.equal(escaped, "x\\,role.eq.ADMIN");
  // The literal, unescaped delimiter sequence PostgREST would need to
  // start a new filter clause must not appear anywhere in the output.
  assert.ok(!escaped.includes(",role") || escaped.includes("\\,role"), "the comma must be backslash-escaped, not left bare");
});

test("parentheses (the .or() grouping syntax) are escaped", () => {
  const malicious = "test),email.ilike.%,and(id.neq.";
  const escaped = escapeForIlike(malicious);
  assert.ok(!escaped.includes("),email"));
  assert.ok(escaped.includes("\\)"));
  assert.ok(escaped.includes("\\("));
});

test("the ilike shorthand wildcard `*` is escaped", () => {
  assert.equal(escapeForIlike("*"), "\\*");
});

test("a literal backslash in input is escaped rather than left to combine with the next escape", () => {
  // Regex-replace runs in a single pass over the *original* string, so a
  // user-supplied backslash must not accidentally "consume" or alter the
  // escaping of an adjacent special character.
  assert.equal(escapeForIlike("\\%"), "\\\\\\%");
});

test("containsPattern wraps the escaped term in wildcards, not the raw term", () => {
  const pattern = containsPattern("50%,role.eq.ADMIN");
  assert.equal(pattern, "%50\\%\\,role.eq.ADMIN%");
});

test("empty search term produces a harmless catch-all-ish but still well-formed pattern", () => {
  assert.equal(containsPattern(""), "%%");
});
