import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { QuizAnswerReview, QuizAttempt } from "../../types";
import { LoadingState, ErrorState, EmptyState } from "../common/States";
import Modal from "../modals/Modal";
import { ArrowLeftIcon } from "../common/Icons";
import QuizAttemptDetail from "../quiz/QuizAttemptDetail";

export default function QuizResultsView({ quizId, quizTitle, onBack }: { quizId: string; quizTitle: string; onBack: () => void }) {
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingAttemptId, setViewingAttemptId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ attempt: QuizAttempt; answers: QuizAnswerReview[] } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await apiRequest<{ attempts: QuizAttempt[] }>(`/quizzes/${quizId}/results`);
      setAttempts(data.attempts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load results.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  useEffect(() => {
    if (!viewingAttemptId) return;
    setDetail(null);
    setDetailError(null);
    apiRequest<{ attempt: QuizAttempt; answers: QuizAnswerReview[] }>(`/quizzes/${quizId}/results/${viewingAttemptId}`)
      .then(setDetail)
      .catch((err) => setDetailError(err instanceof ApiError ? err.message : "Couldn't load this attempt."));
  }, [viewingAttemptId, quizId]);

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:underline">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to quiz
      </button>
      <h1 className="mb-5 font-display text-xl font-semibold text-ink-950">Results — {quizTitle}</h1>

      {attempts === null && !error && <LoadingState label="Loading results…" />}
      {error && <ErrorState message={error} onRetry={load} />}
      {attempts && attempts.length === 0 && <EmptyState title="No attempts yet" description="Results will appear here once students take this quiz." />}

      {attempts && attempts.length > 0 && (
        <div className="overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Student</th>
                <th className="px-5 py-3 font-medium">Attempt</th>
                <th className="px-5 py-3 font-medium">Score</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/8">
              {attempts.map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-ink-100/40" onClick={() => setViewingAttemptId(a.id)}>
                  <td className="px-5 py-3 font-medium text-ink-900">{a.student?.name || a.student?.email || "—"}</td>
                  <td className="px-5 py-3 text-ink-500">#{a.attemptNumber}</td>
                  <td className="px-5 py-3 text-ink-700">
                    {a.score}/{a.totalQuestions} ({Math.round(a.percent)}%)
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${a.passed ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-red-500/25 bg-red-500/10 text-red-700"}`}>
                      {a.passed ? "Passed" : "Failed"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{a.completedAt ? new Date(a.completedAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewingAttemptId && (
        <Modal title="Attempt detail" onClose={() => setViewingAttemptId(null)} maxWidth="max-w-2xl">
          {detailError && <ErrorState message={detailError} />}
          {!detail && !detailError && <LoadingState label="Loading answers…" />}
          {detail && (
            <>
              <p className="mb-4 text-sm text-ink-500">
                {detail.attempt.student?.name || detail.attempt.student?.email} · Score {detail.attempt.score}/{detail.attempt.totalQuestions} ({Math.round(detail.attempt.percent)}%) ·{" "}
                <span className={detail.attempt.passed ? "font-medium text-emerald-700" : "font-medium text-red-600"}>{detail.attempt.passed ? "Passed" : "Failed"}</span>
              </p>
              <QuizAttemptDetail answers={detail.answers} />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
