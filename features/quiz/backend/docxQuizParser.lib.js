const { readDocxPart } = require("./docxZip.lib");

/**
 * Decodes the small set of XML entities WordprocessingML actually emits
 * inside <w:t> runs. Not a general XML-entity decoder — deliberately
 * narrow, since this text is about to be treated as plain quiz content,
 * not re-interpreted as markup.
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * Splits word/document.xml into an ordered array of paragraph strings.
 *
 * WordprocessingML represents a paragraph as a <w:p> element containing
 * one or more <w:r> "runs", each of which may contain a <w:t> text node.
 * A single logical line of text (e.g. "A. Hyper Text Markup Language")
 * is very often split across several runs by Word itself (formatting
 * boundaries, spell-check markers, etc.), so this joins every <w:t>
 * inside one <w:p> together with no separator before treating that as
 * one line — inserting a separator would wrongly split words that Word
 * itself split mid-run.
 */
function extractParagraphs(documentXml) {
  const paragraphMatches = documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  return paragraphMatches.map((p) => {
    const textMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    const text = textMatches
      .map((t) => {
        const inner = t.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, "");
        return decodeXmlEntities(inner);
      })
      .join("");
    return text.trim();
  });
}

/**
 * Reads a .docx file buffer and returns its body text as an array of
 * paragraph strings (blank paragraphs kept as empty strings, since they
 * mark the gaps between questions in the recommended format).
 */
function extractDocxParagraphs(docxBuffer) {
  const documentXml = readDocxPart(docxBuffer, "word/document.xml");
  if (!documentXml) {
    throw new Error("This file doesn't look like a valid .docx document (missing word/document.xml).");
  }
  return extractParagraphs(documentXml);
}

const QUIZ_TITLE_RE = /^quiz\s*[:\-]\s*(.+)$/i;
const QUESTION_START_RE = /^(\d{1,3})[.)\u3001:]\s*(.+)$/;
const OPTION_RE = /^([A-Da-d])[.)\u3001:]\s*(.+)$/;
const ANSWER_RE = /^(?:correct\s+)?answer\s*[:\-]?\s*([A-Da-d])\b/i;
const EXPLANATION_RE = /^explanation\s*[:\-]?\s*(.+)$/i;

/**
 * Turns one in-progress question buffer into the shape the rest of the
 * app (manual creation, preview, import) expects, deciding validity
 * along the way. Never throws — an unparsable question is returned with
 * `valid: false` and a human-readable `issues` list so the admin can
 * fix it by hand in the import preview instead of the whole upload
 * failing.
 */
function finalizeQuestion(draft) {
  const issues = [];
  const questionText = draft.textLines.join(" ").trim();
  if (!questionText) issues.push("Question text is missing.");

  for (const letter of ["A", "B", "C", "D"]) {
    if (!draft.options[letter] || !draft.options[letter].trim()) {
      issues.push(`Option ${letter} is missing.`);
    }
  }

  let correctOption = draft.correctOption ? draft.correctOption.toUpperCase() : null;
  if (!correctOption) {
    issues.push("No correct answer was detected (expected a line like \"Answer: A\").");
  } else if (!draft.options[correctOption] || !draft.options[correctOption].trim()) {
    issues.push(`The detected answer (${correctOption}) doesn't match any of the four options.`);
  }

  return {
    sourceNumber: draft.number,
    questionText,
    optionA: draft.options.A ? draft.options.A.trim() : "",
    optionB: draft.options.B ? draft.options.B.trim() : "",
    optionC: draft.options.C ? draft.options.C.trim() : "",
    optionD: draft.options.D ? draft.options.D.trim() : "",
    correctOption: correctOption && draft.options[correctOption] ? correctOption : null,
    explanation: draft.explanation ? draft.explanation.trim() : "",
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Parses an array of paragraph lines (see extractDocxParagraphs) into a
 * quiz, following the recommended Word format from the product spec:
 *
 *   Quiz: <title>
 *   (optional description line(s) before the first numbered question)
 *
 *   1. <question text>
 *   A. <option>
 *   B. <option>
 *   C. <option>
 *   D. <option>
 *   Answer: <A|B|C|D>
 *   (optional) Explanation: <text>
 *
 * Never throws on malformed input — anything that doesn't fit the
 * pattern becomes a `needs_review` question in the returned array
 * rather than aborting the whole import (per spec #3: "If extraction
 * fails for a question, show Needs Review and allow Admin to fix it
 * manually").
 */
function parseQuizFromParagraphs(lines) {
  let title = "";
  const descriptionLines = [];
  const questions = [];

  let current = null; // in-progress question draft
  let sawTitle = false;
  let sawFirstQuestion = false;

  function pushCurrent() {
    if (current) {
      questions.push(finalizeQuestion(current));
      current = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const titleMatch = !sawTitle ? QUIZ_TITLE_RE.exec(line) : null;
    if (titleMatch) {
      title = titleMatch[1].trim();
      sawTitle = true;
      continue;
    }

    const questionMatch = QUESTION_START_RE.exec(line);
    if (questionMatch) {
      pushCurrent();
      current = { number: questionMatch[1], textLines: [questionMatch[2].trim()], options: {}, correctOption: null, explanation: "" };
      sawFirstQuestion = true;
      continue;
    }

    if (!sawFirstQuestion) {
      // Anything before the first numbered question (other than the
      // "Quiz:" title line) is treated as the quiz description.
      descriptionLines.push(line);
      continue;
    }

    const optionMatch = OPTION_RE.exec(line);
    if (optionMatch && current) {
      current.options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
      continue;
    }

    const answerMatch = ANSWER_RE.exec(line);
    if (answerMatch && current) {
      current.correctOption = answerMatch[1].toUpperCase();
      continue;
    }

    const explanationMatch = EXPLANATION_RE.exec(line);
    if (explanationMatch && current) {
      current.explanation = current.explanation ? `${current.explanation} ${explanationMatch[1].trim()}` : explanationMatch[1].trim();
      continue;
    }

    // An unrecognized line while a question is open and no options have
    // been captured yet is treated as a continuation of the question
    // text (Word sometimes wraps a long question onto its own
    // paragraph). Once options have started, stray lines are appended
    // to the explanation instead of silently dropped, so nothing an
    // admin wrote is lost — it just needs review.
    if (current) {
      if (Object.keys(current.options).length === 0) {
        current.textLines.push(line);
      } else {
        current.explanation = current.explanation ? `${current.explanation} ${line}` : line;
      }
    }
  }
  pushCurrent();

  const summary = {
    found: questions.length,
    valid: questions.filter((q) => q.valid).length,
    needsReview: questions.filter((q) => !q.valid).length,
  };

  return {
    title: title || "Imported Quiz",
    description: descriptionLines.join(" ").trim(),
    questions,
    summary,
  };
}

/** Convenience wrapper: .docx buffer straight to a parsed quiz. */
function parseQuizFromDocxBuffer(docxBuffer) {
  const paragraphs = extractDocxParagraphs(docxBuffer);
  return parseQuizFromParagraphs(paragraphs);
}

module.exports = {
  extractParagraphs,
  extractDocxParagraphs,
  parseQuizFromParagraphs,
  parseQuizFromDocxBuffer,
};
