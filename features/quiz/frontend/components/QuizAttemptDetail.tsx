import type { QuizAnswerReview, QuizOptionLetter } from "../../../../shared/frontend-core/types/index";
import { CheckIcon, XIcon } from "../../../../shared/frontend-core/components/common/Icons";

const LETTERS: QuizOptionLetter[] = ["A", "B", "C", "D"];

export default function QuizAttemptDetail({ answers }: { answers: QuizAnswerReview[] }) {
  return (
    <div className="space-y-4">
      {answers.map((a, index) => (
        <div key={a.questionId} className={`rounded-xl2 border p-4 ${a.isCorrect ? "border-emerald-500/25 bg-emerald-500/5" : "border-red-500/25 bg-red-500/5"}`}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-medium text-ink-900">
              {index + 1}. {a.questionText}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                a.isCorrect ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"
              }`}
            >
              {a.isCorrect ? <CheckIcon className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
              {a.isCorrect ? "Correct" : "Wrong"}
            </span>
          </div>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {LETTERS.map((letter) => {
              const optionKey = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
              const isCorrectOption = a.correctOption === letter;
              const isSelected = a.selectedOption === letter;
              return (
                <p
                  key={letter}
                  className={
                    isCorrectOption ? "font-medium text-emerald-700" : isSelected ? "font-medium text-red-600" : "text-ink-500"
                  }
                >
                  {letter}. {a[optionKey]}
                  {isCorrectOption && " ✓ correct answer"}
                  {isSelected && !isCorrectOption && " ← student's answer"}
                </p>
              );
            })}
          </div>
          {!a.selectedOption && <p className="mt-1.5 text-xs italic text-ink-400">No answer selected.</p>}
          {a.explanation && <p className="mt-2 text-sm text-ink-600">{a.explanation}</p>}
        </div>
      ))}
    </div>
  );
}
