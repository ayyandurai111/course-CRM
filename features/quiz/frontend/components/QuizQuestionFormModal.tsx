import { useState, FormEvent } from "react";
import Modal from "../../../../shared/frontend-core/components/modals/Modal";
import { Field, inputClass, PrimaryButton } from "../../../../shared/frontend-core/components/forms/FormFields";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import type { QuizOptionLetter, QuizQuestion } from "../../../../shared/frontend-core/types/index";

const LETTERS: QuizOptionLetter[] = ["A", "B", "C", "D"];

export default function QuizQuestionFormModal({
  quizId,
  question,
  onClose,
  onSaved,
}: {
  quizId: string;
  question: QuizQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [questionText, setQuestionText] = useState(question?.questionText ?? "");
  const [options, setOptions] = useState({
    A: question?.optionA ?? "",
    B: question?.optionB ?? "",
    C: question?.optionC ?? "",
    D: question?.optionD ?? "",
  });
  const [correctOption, setCorrectOption] = useState<QuizOptionLetter | "">(question?.correctOption ?? "");
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!correctOption) {
      setError("Please select the correct answer.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        questionText,
        optionA: options.A,
        optionB: options.B,
        optionC: options.C,
        optionD: options.D,
        correctOption,
        explanation: explanation || undefined,
      };
      if (question) {
        await apiRequest(`/quizzes/${quizId}/questions/${question.id}`, { method: "PATCH", body });
      } else {
        await apiRequest(`/quizzes/${quizId}/questions`, { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this question.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={question ? "Edit question" : "Add question"} onClose={onClose} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit}>
        <Field label="Question" htmlFor="q-text">
          <textarea id="q-text" required rows={2} value={questionText} onChange={(e) => setQuestionText(e.target.value)} className={inputClass} placeholder="What does HTML stand for?" />
        </Field>

        <p className="mb-1.5 text-sm font-medium text-ink-700">Answers — select the correct one</p>
        <div className="mb-4 space-y-2">
          {LETTERS.map((letter) => (
            <div key={letter} className="flex items-center gap-2">
              <input
                type="radio"
                name="correctOption"
                checked={correctOption === letter}
                onChange={() => setCorrectOption(letter)}
                className="h-4 w-4 shrink-0 accent-ink-950"
                aria-label={`Option ${letter} is correct`}
              />
              <span className="w-5 shrink-0 text-sm font-semibold text-ink-500">{letter}.</span>
              <input
                required
                value={options[letter]}
                onChange={(e) => setOptions((o) => ({ ...o, [letter]: e.target.value }))}
                className={inputClass}
                placeholder={`Option ${letter}`}
              />
            </div>
          ))}
        </div>

        <Field label="Explanation" htmlFor="q-explanation" hint="Optional — shown to students after they submit their answer.">
          <textarea id="q-explanation" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} className={inputClass} />
        </Field>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Saving…" : "Save question"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
