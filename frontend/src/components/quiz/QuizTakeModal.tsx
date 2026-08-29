import { useEffect, useState } from "react";
import Modal from "../modals/Modal";
import { apiRequest, ApiError } from "../../lib/apiClient";
import { LoadingState, ErrorState } from "../common/States";
import { AwardIcon, ChevronLeftIcon, ChevronRightIcon } from "../common/Icons";
import type { Quiz, StudentQuizQuestion, QuizAttemptResult, QuizOptionLetter } from "../../types";
import QuizAttemptDetail from "./QuizAttemptDetail";

const LETTERS: QuizOptionLetter[] = ["A", "B", "C", "D"];

export default function QuizTakeModal({ quizId, onClose, onCompleted }: { quizId: string; onClose: () => void; onCompleted: () => void }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<StudentQuizQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizOptionLetter>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    apiRequest<{ quiz: Quiz; questions: StudentQuizQuestion[] }>(`/quizzes/${quizId}`)
      .then((data) => {
        setQuiz(data.quiz);
        setQuestions(data.questions);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load this quiz."));
  }, [quizId]);

  async function handleSubmit() {
    if (!questions) return;
    const unanswered = questions.length - Object.keys(answers).length;
    if (unanswered > 0 && !confirm(`You haven't answered ${unanswered} question${unanswered === 1 ? "" : "s"}. Submit anyway?`)) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        answers: questions.map((q) => ({ questionId: q.id, selectedOption: answers[q.id] ?? null })),
      };
      const data = await apiRequest<QuizAttemptResult>(`/quizzes/${quizId}/submit`, { method: "POST", body: payload });
      setResult(data);
      onCompleted();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Couldn't submit your quiz. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const correct = result.score;
    const wrong = result.totalQuestions - result.score;
    return (
      <Modal title="Quiz Completed" onClose={onClose} maxWidth="max-w-xl">
        {!showReview ? (
          <div className="text-center">
            <AwardIcon className={`mx-auto h-14 w-14 ${result.passed ? "text-emerald-500" : "text-ink-300"}`} />
            <p className="mt-4 font-display text-3xl font-semibold text-ink-950">
              {result.score} / {result.totalQuestions}
            </p>
            <p className="mt-1 text-lg font-medium text-ink-700">{Math.round(result.percent)}%</p>
            <div className="mt-4 flex justify-center gap-6 text-sm">
              <span className="text-emerald-700">Correct: {correct}</span>
              <span className="text-red-600">Wrong: {wrong}</span>
            </div>
            <span
              className={`mt-4 inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${
                result.passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-red-500/25 bg-red-500/10 text-red-700"
              }`}
            >
              Status: {result.passed ? "Passed" : "Failed"}
            </span>
            <div className="mt-6 flex justify-center gap-2">
              <button onClick={() => setShowReview(true)} className="rounded-full border border-ink-900/15 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
                Review answers
              </button>
              <button onClick={onClose} className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 hover:bg-ink-900">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div>
            <QuizAttemptDetail answers={result.answers} />
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 hover:bg-ink-900">
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={quiz?.title || "Quiz"} onClose={onClose} maxWidth="max-w-xl">
      {loadError && <ErrorState message={loadError} />}
      {!loadError && (!quiz || !questions) && <LoadingState label="Loading quiz…" />}
      {quiz && questions && questions.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-ink-500">
            Question {index + 1} of {questions.length}
          </p>
          <p className="mb-5 font-display text-lg font-semibold text-ink-950">{questions[index].questionText}</p>

          <div className="space-y-2.5">
            {LETTERS.map((letter) => {
              const optionKey = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
              const question = questions[index];
              const isSelected = answers[question.id] === letter;
              return (
                <label
                  key={letter}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${
                    isSelected ? "border-ink-950 bg-ink-100/60" : "border-ink-900/15 hover:bg-ink-100/40"
                  }`}
                >
                  <input
                    type="radio"
                    name={`answer-${question.id}`}
                    checked={isSelected}
                    onChange={() => setAnswers((a) => ({ ...a, [question.id]: letter }))}
                    className="h-4 w-4 shrink-0 accent-ink-950"
                  />
                  <span className="font-semibold text-ink-500">{letter}.</span>
                  <span className="text-ink-900">{question[optionKey]}</span>
                </label>
              );
            })}
          </div>

          {submitError && <p className="mt-4 text-sm text-red-600">{submitError}</p>}

          <div className="mt-6 flex items-center justify-between border-t border-ink-900/8 pt-4">
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="inline-flex items-center gap-1 rounded-full border border-ink-900/15 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-40"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Previous
            </button>

            {index < questions.length - 1 ? (
              <button
                onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                className="inline-flex items-center gap-1 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
              >
                Next
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 hover:bg-ink-900 disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit Quiz"}
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden="true">
            {questions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => setIndex(i)}
                className={`h-2 w-6 rounded-full transition ${
                  i === index ? "bg-ink-950" : answers[q.id] ? "bg-emerald-400" : "bg-ink-200"
                }`}
                aria-label={`Go to question ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
