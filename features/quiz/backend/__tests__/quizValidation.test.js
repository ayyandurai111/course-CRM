const test = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestionFields, canPublishQuiz } = require("../quizValidation.lib");

test("a fully-populated question is valid", () => {
  const result = validateQuestionFields({
    questionText: "2+2?",
    optionA: "3",
    optionB: "4",
    optionC: "5",
    optionD: "6",
    correctOption: "b",
  });
  assert.equal(result.ok, true);
  assert.equal(result.correctOption, "B"); // normalized to uppercase
});

test("missing question text is rejected", () => {
  const result = validateQuestionFields({ questionText: "", optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "A" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /Question text/.test(i)));
});

test("each missing option is reported individually", () => {
  const result = validateQuestionFields({ questionText: "Q", optionA: "a", optionB: "", optionC: "", optionD: "d", correctOption: "A" });
  assert.equal(result.ok, false);
  assert.equal(result.issues.filter((i) => /Option/.test(i)).length, 2);
});

test("an out-of-range correct answer is rejected", () => {
  const result = validateQuestionFields({ questionText: "Q", optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "E" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /correct answer/i.test(i)));
});

test("canPublishQuiz rejects an empty question list", () => {
  const result = canPublishQuiz([]);
  assert.equal(result.ok, false);
});

test("canPublishQuiz rejects if any question is incomplete", () => {
  const good = { questionText: "Q1", optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "A" };
  const bad = { questionText: "Q2", optionA: "a", optionB: "", optionC: "c", optionD: "d", correctOption: "A" };
  const result = canPublishQuiz([good, bad]);
  assert.equal(result.ok, false);
});

test("canPublishQuiz accepts a quiz where every question is complete", () => {
  const good1 = { questionText: "Q1", optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "A" };
  const good2 = { questionText: "Q2", optionA: "a", optionB: "b", optionC: "c", optionD: "d", correctOption: "C" };
  const result = canPublishQuiz([good1, good2]);
  assert.equal(result.ok, true);
});
