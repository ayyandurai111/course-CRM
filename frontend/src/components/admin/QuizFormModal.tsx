import { useState, FormEvent } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Course, Quiz } from "../../types";

export default function QuizFormModal({
  courses,
  onClose,
  onSaved,
}: {
  courses: Course[];
  onClose: () => void;
  onSaved: (quiz: Quiz) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState("");
  const [passPercent, setPassPercent] = useState(70);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!courseId) {
      setError("Please choose a course.");
      return;
    }
    setSaving(true);
    try {
      const { quiz } = await apiRequest<{ quiz: Quiz }>("/quizzes", {
        method: "POST",
        body: { title, description: description || undefined, courseId, passPercent },
      });
      onSaved(quiz);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create this quiz.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Create Quiz" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Quiz title" htmlFor="quiz-title">
          <input id="quiz-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} placeholder="HTML Basics" />
        </Field>
        <Field label="Description" htmlFor="quiz-description" hint="Optional — shown to students before they start.">
          <textarea id="quiz-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </Field>
        <Field label="Course" htmlFor="quiz-course">
          <select id="quiz-course" required value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
            <option value="">Select a course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pass percentage" htmlFor="quiz-pass" hint="Minimum score a student needs to pass this quiz.">
          <input
            id="quiz-pass"
            type="number"
            min={0}
            max={100}
            required
            value={passPercent}
            onChange={(e) => setPassPercent(Number(e.target.value))}
            className={inputClass}
          />
        </Field>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Creating…" : "Create & add questions"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
