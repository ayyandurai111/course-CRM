import { useRef, useState } from "react";
import Modal from "../../../../shared/frontend-core/components/modals/Modal";
import { Field, inputClass } from "../../../../shared/frontend-core/components/forms/FormFields";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import type { Course, ImportedQuizQuestion, Quiz, QuizOptionLetter } from "../../../../shared/frontend-core/types/index";
import { UploadIcon, CheckIcon, XIcon } from "../../../../shared/frontend-core/components/common/Icons";

const LETTERS: QuizOptionLetter[] = ["A", "B", "C", "D"];

type PreviewData = {
  title: string;
  description: string;
  questions: ImportedQuizQuestion[];
  summary: { found: number; valid: number; needsReview: number };
};

// Re-runs the same "is this question complete" check the backend uses,
// so an admin's inline edit in the preview flips a row from "Needs
// review" to "Valid" (or back) immediately, without a round trip.
function revalidate(q: ImportedQuizQuestion): ImportedQuizQuestion {
  const issues: string[] = [];
  if (!q.questionText.trim()) issues.push("Question text is required.");
  for (const letter of LETTERS) {
    const value = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD }[letter];
    if (!value.trim()) issues.push(`Option ${letter} is required.`);
  }
  if (!q.correctOption) issues.push("A correct answer is required.");
  return { ...q, valid: issues.length === 0, issues };
}

export default function QuizImportModal({
  courses,
  onClose,
  onImported,
}: {
  courses: Course[];
  onClose: () => void;
  onImported: (quiz: Quiz) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [courseId, setCourseId] = useState("");
  const [passPercent, setPassPercent] = useState(70);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await apiRequest<PreviewData>("/quizzes/import/preview", { method: "POST", body: formData, isFormData: true });
      setPreview(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read this Word document.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updateQuestion(tempId: string, patch: Partial<ImportedQuizQuestion>) {
    setPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.tempId === tempId ? revalidate({ ...q, ...patch }) : q)),
      };
    });
  }

  function deleteQuestion(tempId: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const questions = prev.questions.filter((q) => q.tempId !== tempId);
      return {
        ...prev,
        questions,
        summary: { found: questions.length, valid: questions.filter((q) => q.valid).length, needsReview: questions.filter((q) => !q.valid).length },
      };
    });
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setError(null);
    if (!courseId) {
      setError("Please choose a course.");
      return;
    }
    if (status === "PUBLISHED" && preview.questions.some((q) => !q.valid)) {
      setError("Every question must be valid before publishing. Fix or delete the flagged rows, or import as a Draft instead.");
      return;
    }
    if (status === "DRAFT" && preview.questions.every((q) => !q.valid)) {
      setError("None of the imported questions are complete enough to save. Fix them below and try again.");
      return;
    }
    setImporting(true);
    try {
      const { quiz } = await apiRequest<{ quiz: Quiz }>("/quizzes/import/confirm", {
        method: "POST",
        body: {
          courseId,
          title: preview.title,
          description: preview.description || undefined,
          passPercent,
          status,
          questions: preview.questions.map((q) => ({
            questionText: q.questionText,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            correctOption: q.correctOption || "",
            explanation: q.explanation || undefined,
          })),
        },
      });
      onImported(quiz);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't import this quiz.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal title="Import Quiz from Word" onClose={onClose} maxWidth="max-w-3xl">
      {!preview && (
        <div>
          <p className="mb-4 text-sm text-ink-500">
            Upload a .docx file using the recommended format: <span className="font-medium text-ink-700">Quiz: Title</span>, numbered questions, options
            labeled A–D, and an <span className="font-medium text-ink-700">Answer: X</span> line for each question.
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl2 border-2 border-dashed border-ink-300/60 bg-paper-50 px-6 py-12 text-center hover:border-ink-500/60">
            <UploadIcon className="h-8 w-8 text-ink-400" />
            <span className="text-sm font-medium text-ink-700">{uploading ? "Reading document…" : "Click to choose a .docx file"}</span>
            <input ref={fileInputRef} type="file" accept=".docx" className="hidden" disabled={uploading} onChange={handleFileChange} />
          </label>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      )}

      {preview && (
        <div>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Field label="Quiz title" htmlFor="import-title">
              <input id="import-title" value={preview.title} onChange={(e) => setPreview({ ...preview, title: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Course" htmlFor="import-course">
              <select id="import-course" value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
                <option value="">Select a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pass percentage" htmlFor="import-pass">
              <input id="import-pass" type="number" min={0} max={100} value={passPercent} onChange={(e) => setPassPercent(Number(e.target.value))} className={inputClass} />
            </Field>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl2 border border-ink-900/8 bg-paper-50 px-4 py-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="font-medium text-ink-900">Questions Found: {preview.summary.found}</span>
              <span className="font-medium text-emerald-700">Valid: {preview.summary.valid}</span>
              <span className={`font-medium ${preview.summary.needsReview > 0 ? "text-amber-600" : "text-ink-500"}`}>Needs Review: {preview.summary.needsReview}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={status === "DRAFT"} onChange={() => setStatus("DRAFT")} className="accent-ink-950" />
                Save as Draft
              </label>
              <label className="ml-3 flex items-center gap-1.5">
                <input type="radio" checked={status === "PUBLISHED"} onChange={() => setStatus("PUBLISHED")} className="accent-ink-950" />
                Publish now
              </label>
            </div>
          </div>

          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {preview.questions.map((q, index) => (
              <div key={q.tempId} className={`rounded-xl2 border p-4 ${q.valid ? "border-ink-900/8 bg-white" : "border-amber-400/50 bg-amber-400/5"}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {q.valid ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700">
                        <CheckIcon className="h-3 w-3" /> Valid
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-amber-700">Needs review</span>
                    )}
                    <span className="text-ink-400">Question {index + 1}</span>
                  </span>
                  <button onClick={() => deleteQuestion(q.tempId)} aria-label="Delete question" className="rounded-full p-1 text-ink-400 hover:bg-ink-100 hover:text-red-600">
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                <textarea
                  value={q.questionText}
                  onChange={(e) => updateQuestion(q.tempId, { questionText: e.target.value })}
                  rows={2}
                  className={`${inputClass} mb-2`}
                  placeholder="Question text"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {LETTERS.map((letter) => {
                    const optionKey = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
                    return (
                      <div key={letter} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${q.tempId}`}
                          checked={q.correctOption === letter}
                          onChange={() => updateQuestion(q.tempId, { correctOption: letter })}
                          className="h-4 w-4 shrink-0 accent-ink-950"
                          aria-label={`Option ${letter} is correct`}
                        />
                        <span className="w-4 shrink-0 text-xs font-semibold text-ink-500">{letter}</span>
                        <input
                          value={q[optionKey]}
                          onChange={(e) => updateQuestion(q.tempId, { [optionKey]: e.target.value } as Partial<ImportedQuizQuestion>)}
                          className="w-full rounded-lg border border-ink-900/15 px-2.5 py-1.5 text-sm outline-none focus:border-ink-950"
                        />
                      </div>
                    );
                  })}
                </div>
                {!q.valid && q.issues.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                    {q.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {preview.questions.length === 0 && <p className="py-6 text-center text-sm text-ink-500">No questions left — delete the file input and try re-uploading.</p>}
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex justify-end gap-2 border-t border-ink-900/8 pt-4">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={importing || preview.questions.length === 0}
              className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 transition hover:bg-ink-900 disabled:opacity-60"
            >
              {importing ? "Importing…" : "Confirm & Import"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
