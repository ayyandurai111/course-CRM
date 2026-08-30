import type { Quiz } from "../../../../shared/frontend-core/types/index";
import { HelpCircleIcon, AwardIcon } from "../../../../shared/frontend-core/components/common/Icons";

export default function QuizCard({ quiz, onStart }: { quiz: Quiz; onStart: (quiz: Quiz) => void }) {
  const hasAttempted = !!quiz.lastAttempt;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card">
      <div className="relative flex h-40 w-full items-center justify-center overflow-hidden bg-ink-100">
        <HelpCircleIcon className="h-10 w-10 text-ink-300" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-medium tracking-wide text-ink-950">
          <HelpCircleIcon className="h-3.5 w-3.5" />
          Quiz
        </span>
        {hasAttempted && (
          <span
            className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-xs font-medium text-white ${
              quiz.lastAttempt?.passed ? "bg-emerald-500" : "bg-red-500"
            }`}
          >
            {quiz.lastAttempt?.passed ? "Passed" : "Completed"}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {quiz.course && <p className="text-xs font-medium text-ink-500">{quiz.course.title}</p>}
        <h3 className="mt-1 font-display text-base font-semibold text-ink-950">{quiz.title}</h3>
        {quiz.description && <p className="mt-1 line-clamp-2 flex-1 text-sm text-ink-500">{quiz.description}</p>}

        <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
          <span>
            {quiz.questionCount ?? 0} question{(quiz.questionCount ?? 0) === 1 ? "" : "s"}
          </span>
          <span>· Pass at {quiz.passPercent}%</span>
        </div>

        {hasAttempted && quiz.lastAttempt && (
          <div className="mt-3 flex items-center gap-1.5 text-sm">
            <AwardIcon className={`h-4 w-4 ${quiz.lastAttempt.passed ? "text-emerald-600" : "text-ink-400"}`} />
            <span className="font-medium text-ink-900">{Math.round(quiz.lastAttempt.percent)}%</span>
            <span className="text-ink-500">
              best score {quiz.bestPercent != null ? `${Math.round(quiz.bestPercent)}%` : ""} · {quiz.attemptsCount} attempt{quiz.attemptsCount === 1 ? "" : "s"}
            </span>
          </div>
        )}

        <button
          onClick={() => onStart(quiz)}
          className="mt-4 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-ink-900"
        >
          {hasAttempted ? "Retake Quiz" : "Start Quiz"}
        </button>
      </div>
    </article>
  );
}
