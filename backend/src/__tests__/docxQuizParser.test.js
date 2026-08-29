const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { parseQuizFromParagraphs, parseQuizFromDocxBuffer } = require("../lib/docxQuizParser");

test("parses a well-formed quiz with two questions", () => {
  const lines = [
    "Quiz: HTML Basics",
    "",
    "1. What does HTML stand for?",
    "",
    "A. Hyper Text Markup Language",
    "B. High Text Machine Language",
    "C. Hyperlink Text Management Language",
    "D. Home Tool Markup Language",
    "",
    "Answer: A",
    "",
    "2. Which tag is used for a paragraph?",
    "",
    "A. <h1>",
    "B. <p>",
    "C. <div>",
    "D. <br>",
    "",
    "Answer: B",
  ];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.title, "HTML Basics");
  assert.equal(result.summary.found, 2);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.needsReview, 0);

  const [q1, q2] = result.questions;
  assert.equal(q1.questionText, "What does HTML stand for?");
  assert.equal(q1.optionA, "Hyper Text Markup Language");
  assert.equal(q1.correctOption, "A");
  assert.equal(q1.valid, true);

  assert.equal(q2.optionB, "<p>");
  assert.equal(q2.correctOption, "B");
  assert.equal(q2.valid, true);
});

test("flags a question missing an answer line as needs-review", () => {
  const lines = [
    "Quiz: No Answer",
    "1. What color is the sky?",
    "A. Blue",
    "B. Green",
    "C. Red",
    "D. Purple",
  ];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.summary.needsReview, 1);
  assert.equal(result.questions[0].valid, false);
  assert.ok(result.questions[0].issues.some((i) => /no correct answer/i.test(i)));
});

test("flags a question with fewer than 4 options as needs-review", () => {
  const lines = ["Quiz: Short Options", "1. Pick one", "A. First", "B. Second", "Answer: A"];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.questions[0].valid, false);
  assert.ok(result.questions[0].issues.some((i) => /Option C is missing/.test(i)));
  assert.ok(result.questions[0].issues.some((i) => /Option D is missing/.test(i)));
});

test("flags an answer letter outside A-D as not detected", () => {
  // "E" is never a legal option letter (exactly 4 answers, A-D, per
  // spec), so this is correctly treated the same as a missing answer
  // line rather than guessed at.
  const lines = ["Quiz: Bad Answer", "1. Pick one", "A. First", "B. Second", "C. Third", "D. Fourth", "Answer: E"];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.questions[0].valid, false);
  assert.ok(result.questions[0].issues.some((i) => /no correct answer/i.test(i)));
});

test("flags an answer letter that doesn't match any option actually present", () => {
  const lines = ["Quiz: Bad Answer 2", "1. Pick one", "A. First", "B. Second", "C. Third", "Answer: D"];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.questions[0].valid, false);
  assert.ok(result.questions[0].issues.some((i) => /doesn't match any of the four options/.test(i)));
});

test("captures an explanation line when present", () => {
  const lines = [
    "Quiz: Explained",
    "1. 2 + 2 = ?",
    "A. 3",
    "B. 4",
    "C. 5",
    "D. 6",
    "Answer: B",
    "Explanation: Basic addition.",
  ];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.questions[0].explanation, "Basic addition.");
});

test("text before the first question becomes the quiz description", () => {
  const lines = ["Quiz: With Description", "A short quiz about basics.", "1. Q1", "A. a", "B. b", "C. c", "D. d", "Answer: A"];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.description, "A short quiz about basics.");
});

test("a wrapped multi-line question is joined into one questionText", () => {
  const lines = [
    "Quiz: Wrapped",
    "1. This is a very long question that",
    "was wrapped onto a second line by Word.",
    "A. a",
    "B. b",
    "C. c",
    "D. d",
    "Answer: A",
  ];
  const result = parseQuizFromParagraphs(lines);
  assert.equal(result.questions[0].questionText, "This is a very long question that was wrapped onto a second line by Word.");
});

// ---------------------------------------------------------------------
// Full round trip through a real, hand-built .docx (ZIP) file, to
// exercise docxZip.js's own ZIP/DEFLATE parsing end-to-end.
// ---------------------------------------------------------------------

function buildParagraphXml(text) {
  const escaped = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

/** Minimal but valid .docx: a single ZIP entry, word/document.xml, DEFLATE-compressed. */
function buildTestDocx(lines) {
  const body = lines.map(buildParagraphXml).join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`;

  const nameBuf = Buffer.from("word/document.xml", "utf8");
  const contentBuf = Buffer.from(documentXml, "utf8");
  const compressed = zlib.deflateRawSync(contentBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // method = deflate
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(0, 14); // crc32 (unchecked by our reader)
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(contentBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra length

  const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(8, 10); // method
  centralHeader.writeUInt16LE(0, 12); // time
  centralHeader.writeUInt16LE(0, 14); // date
  centralHeader.writeUInt32LE(0, 16); // crc32
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(contentBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // local header offset

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralEntry.length, 12); // central dir size
  eocd.writeUInt32LE(localEntry.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localEntry, centralEntry, eocd]);
}

test("parseQuizFromDocxBuffer round-trips a real .docx ZIP file", () => {
  const docxBuffer = buildTestDocx([
    "Quiz: HTML Basics",
    "1. What does HTML stand for?",
    "A. Hyper Text Markup Language",
    "B. High Text Machine Language",
    "C. Hyperlink Text Management Language",
    "D. Home Tool Markup Language",
    "Answer: A",
    "2. Which tag is used for a paragraph?",
    "A. <h1>",
    "B. <p>",
    "C. <div>",
    "D. <br>",
    "Answer: B",
  ]);

  const result = parseQuizFromDocxBuffer(docxBuffer);
  assert.equal(result.title, "HTML Basics");
  assert.equal(result.summary.found, 2);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.questions[1].optionC, "<div>");
});

test("parseQuizFromDocxBuffer throws a clear error for a non-docx file", () => {
  assert.throws(() => parseQuizFromDocxBuffer(Buffer.from("not a zip file")), /Not a valid \.docx file/);
});
