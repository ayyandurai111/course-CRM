/**
 * Single source of truth for "is this quiz question well-formed" —
 * shared by the manual question create/update routes and the DOCX
 * import-confirm route, so a question imported from Word is held to
 * exactly the same bar as one typed in by hand.
 */
function validateQuestionFields({ questionText, optionA, optionB, optionC, optionD, correctOption }) {
  const issues = [];
  if (!questionText || !String(questionText).trim()) issues.push("Question text is required.");

  const options = { A: optionA, B: optionB, C: optionC, D: optionD };
  for (const letter of ["A", "B", "C", "D"]) {
    if (!options[letter] || !String(options[letter]).trim()) issues.push(`Option ${letter} is required.`);
  }

  const normalizedCorrect = typeof correctOption === "string" ? correctOption.trim().toUpperCase() : "";
  if (!["A", "B", "C", "D"].includes(normalizedCorrect)) {
    issues.push("A correct answer (A, B, C, or D) is required.");
  }

  return { ok: issues.length === 0, issues, correctOption: normalizedCorrect || null };
}

/**
 * A quiz can only be published once every one of its questions is
 * individually valid (spec: "Quiz can be saved as Draft or Published" —
 * Draft never needs to be complete, Published always does) and it has
 * at least one question.
 */
function canPublishQuiz(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, reason: "A quiz needs at least one question before it can be published." };
  }
  const invalidCount = questions.filter((q) => {
    const result = validateQuestionFields(q);
    return !result.ok;
  }).length;
  if (invalidCount > 0) {
    return { ok: false, reason: `${invalidCount} question(s) are incomplete and must be fixed before publishing.` };
  }
  return { ok: true };
}

module.exports = { validateQuestionFields, canPublishQuiz };
