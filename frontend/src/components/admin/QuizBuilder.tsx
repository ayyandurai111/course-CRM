import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Quiz, QuizQuestion } from "../../types";
import { LoadingState, ErrorState, EmptyState } from "../common/States";
import { Field, inputClass } from "../forms/FormFields";
import { ArrowLeftIcon, PlusIcon, ChevronUpIcon, ChevronDownIcon, AwardIcon } from "../common/Icons";
import QuizQuestionFormModal from "./QuizQuestionFormModal";

export default function QuizBuilder({
  quizId,
  onBack,
  onViewResults,
}: {
  quizId: string;
  onBack: () => void;
  onViewResults: (quizTitle: string) => void;
}) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<QuizQuestion | null | "new">(null);
  const [reordering, setReordering] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Local, editable copies of the quiz meta fields (title/description/pass%).
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passPercent, setPassPercent] = useState(70);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await apiRequest<{ quiz: Quiz; questions: QuizQuestion[] }>(`/quizzes/admin/${quizId}`);
      setQuiz(data.quiz);
      setQuestions(data.questions);
      setTitle(data.quiz.title);
      setDescription(data.quiz.description || "");
      setPassPercent(data.quiz.passPercent);
      setMetaDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this quiz.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  async function saveMeta() {
    setSavingMeta(true);
    try {
      const { quiz: updated } = await apiRequest<{ quiz: Quiz }>(`/quizzes/${quizId}`, {
        method: "PATCH",
        body: { title, description: description || "", passPercent },
      });
      setQuiz(updated);
      setMetaDirty(false);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't save quiz details.");
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleDeleteQuestion(question: QuizQuestion) {
    if (!confirm("Delete this question?")) return;
    try {
      await apiRequest(`/quizzes/${quizId}/questions/${question.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't delete this question.");
    }
  }

  async function moveQuestion(index: number, direction: -1 | 1) {
    if (!questions) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setQuestions(reordered); // optimistic
    setReordering(true);
    try {
      const { questions: saved } = await apiRequest<{ questions: QuizQuestion[] }>(`/quizzes/${quizId}/questions/reorder`, {
        method: "POST",
        body: { orderedIds: reordered.map((q) => q.id) },
      });
      setQuestions(saved);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't reorder questions.");
      load(); // roll back to server state
    } finally {
      setReordering(false);
    }
  }

  async function handlePublishToggle() {
    if (!quiz) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const { quiz: updated } = await apiRequest<{ quiz: Quiz }>(`/quizzes/${quizId}/${quiz.status === "PUBLISHED" ? "unpublish" : "publish"}`, { method: "POST" });
      setQuiz(updated);
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : "Couldn't update the quiz status.");
    } finally {
      setPublishing(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!quiz || !questions) return <LoadingState label="Loading quiz…" />;

  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:underline">
        <ArrowLeftIcon className="h-4 w-4" />
        Back to quizzes
      </button>

      <div className="mb-6 rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-semibold text-ink-950">{quiz.title}</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => onViewResults(quiz.title)} className="inline-flex items-center gap-1.5 rounded-full border border-ink-900/15 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100">
              <AwardIcon className="h-4 w-4" />
              View results
            </button>
            <button
              onClick={handlePublishToggle}
              disabled={publishing}
              className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
                quiz.status === "PUBLISHED" ? "border border-ink-900/15 text-ink-700 hover:bg-ink-100" : "bg-ink-950 text-paper-50 hover:bg-ink-900"
              }`}
            >
              {publishing ? "Working…" : quiz.status === "PUBLISHED" ? "Unpublish" : "Publish"}
            </button>
          </div>
        </div>
        {publishError && <p className="mb-3 text-sm text-red-600">{publishError}</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Quiz title" htmlFor="meta-title">
            <input
              id="meta-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setMetaDirty(true);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Pass percentage" htmlFor="meta-pass">
            <input
              id="meta-pass"
              type="number"
              min={0}
              max={100}
              value={passPercent}
              onChange={(e) => {
                setPassPercent(Number(e.target.value));
                setMetaDirty(true);
              }}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="meta-description">
          <textarea
            id="meta-description"
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setMetaDirty(true);
            }}
            className={inputClass}
          />
        </Field>
        {metaDirty && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveMeta}
              disabled={savingMeta}
              className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 transition hover:bg-ink-900 disabled:opacity-60"
            >
              {savingMeta ? "Saving…" : "Save details"}
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink-950">
          Questions <span className="font-sans text-sm font-normal text-ink-500">({questions.length})</span>
        </h2>
        <button
          onClick={() => setEditingQuestion("new")}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
        >
          <PlusIcon className="h-4 w-4" />
          Add question
        </button>
      </div>

      {questions.length === 0 ? (
        <EmptyState title="No questions yet" description="Add your first question, or import a set from a Word document." />
      ) : (
        <div className="space-y-2">
          {questions.map((q, index) => (
            <div key={q.id} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
                  <button
                    onClick={() => moveQuestion(index, -1)}
                    disabled={index === 0 || reordering}
                    aria-label="Move up"
                    className="rounded p-0.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                  >
                    <ChevronUpIcon className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-semibold text-ink-400">{index + 1}</span>
                  <button
                    onClick={() => moveQuestion(index, 1)}
                    disabled={index === questions.length - 1 || reordering}
                    aria-label="Move down"
                    className="rounded p-0.5 text-ink-400 hover:bg-ink-100 disabled:opacity-30"
                  >
                    <ChevronDownIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900">{q.questionText}</p>
                  <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                    {(["A", "B", "C", "D"] as const).map((letter) => {
                      const optionKey = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
                      const isCorrect = q.correctOption === letter;
                      return (
                        <p key={letter} className={isCorrect ? "font-medium text-emerald-700" : "text-ink-500"}>
                          {letter}. {q[optionKey]} {isCorrect && "✓"}
                        </p>
                      );
                    })}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs font-medium">
                  <button onClick={() => setEditingQuestion(q)} className="text-ink-700 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => handleDeleteQuestion(q)} className="text-red-600 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingQuestion && (
        <QuizQuestionFormModal
          quizId={quizId}
          question={editingQuestion === "new" ? null : editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => {
            setEditingQuestion(null);
            load();
          }}
        />
      )}
    </div>
  );
}
