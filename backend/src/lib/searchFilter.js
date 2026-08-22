/**
 * Escapes a user-supplied search term for safe use inside a PostgREST
 * `ilike` pattern / `.or()` filter string (spec #12D: "use
 * parameterized/query-builder filters. Do not construct raw SQL by
 * string concatenation" — the PostgREST equivalent of that risk is
 * letting `%`, `_`, `,`, `(` or `)` from user input change what the
 * filter actually matches or breaks the `.or()` expression's syntax).
 *
 *  - `%` and `_` are ILIKE wildcard characters — escaped so a search for
 *    "50%" doesn't become an open-ended wildcard match.
 *  - `,` and `(` `)` are the `.or()` filter's own list/grouping
 *    delimiters — escaped so user input can never inject an extra
 *    filter clause. `*` is PostgREST's own ilike shorthand — also escaped.
 */
function escapeForIlike(term) {
  return String(term).replace(/[%_,()*\\]/g, (c) => `\\${c}`);
}

/** Builds a `%term%` "contains" pattern from already-escaped input. */
function containsPattern(term) {
  return `%${escapeForIlike(term)}%`;
}

module.exports = { escapeForIlike, containsPattern };
