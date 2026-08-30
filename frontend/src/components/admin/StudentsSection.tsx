import { useEffect, useState } from "react";
import { apiRequest, ApiError, reportActionError } from "../../lib/apiClient";
import type { Student, Plan } from "../../types";
import { ErrorState, EmptyState } from "../common/States";
import { TableSkeleton } from "../common/Skeleton";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";

function AssignPlanModal({ student, plans, onClose, onSaved }: { student: Student; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/students/${student.id}/subscription`, { method: "POST", body: { planId } });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't assign this plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Assign plan to ${student.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Plan" htmlFor="assign-plan">
          <select id="assign-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} className={inputClass}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="mb-4 text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-medium text-ink-700">
            Cancel
          </button>
          <PrimaryButton disabled={saving || !planId}>{saving ? "Saving…" : "Assign plan"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

export default function StudentsSection() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assigning, setAssigning] = useState<Student | null>(null);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const [s, p] = await Promise.all([
        apiRequest<{ students: Student[] }>(`/students?${params.toString()}`),
        apiRequest<{ plans: Plan[] }>("/plans/admin"),
      ]);
      setStudents(s.students);
      setPlans(p.plans);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load students.");
    }
  }

  useEffect(() => {
    setStudents(null);
    const timer = window.setTimeout(() => {
      load();
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function toggleActive(student: Student) {
    try {
      await apiRequest(`/students/${student.id}/status`, { method: "PATCH", body: { isActive: !student.isActive } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update this student's status.");
    }
  }

  async function handleDelete(student: Student) {
    if (!confirm(`Permanently delete ${student.name}? This removes their account, subscriptions, and progress. This cannot be undone.`)) {
      return;
    }
    try {
      await apiRequest(`/students/${student.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      reportActionError(err, "Couldn't delete this student.");
    }
  }

  return (
    <div>
      <h1 className="mb-5 font-display text-xl font-semibold text-ink-950">Students</h1>
      <input
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-lg border border-ink-900/15 px-3 py-2 text-sm"
      />

      {students === null && !error && <TableSkeleton columns={5} rows={6} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {students && students.length === 0 && <EmptyState title="No students found" />}

      {students && students.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {students.map((s) => (
              <div key={s.id} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{s.name}</p>
                    <p className="truncate text-sm text-ink-500">{s.email}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      s.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"
                    }`}
                  >
                    {s.isActive ? "Active" : "Suspended"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink-500">Plan: {s.subscriptions?.[0]?.plan.name ?? "None"}</p>
                <div className="mt-3 flex flex-wrap gap-4 border-t border-ink-900/8 pt-3">
                  <button onClick={() => setAssigning(s)} disabled={plans.length === 0} className="text-sm font-medium text-ink-700 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50">
                    Assign plan
                  </button>
                  <button onClick={() => toggleActive(s)} className="text-sm font-medium text-amber-600 hover:text-amber-700">
                    {s.isActive ? "Suspend" : "Reactivate"}
                  </button>
                  <button onClick={() => handleDelete(s)} className="text-sm font-medium text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/8">
                {students.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{s.name}</td>
                    <td className="px-5 py-3 text-ink-500">{s.email}</td>
                    <td className="px-5 py-3 text-ink-500">{s.subscriptions?.[0]?.plan.name ?? "None"}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>
                        {s.isActive ? "Active" : "Suspended"}
                      </span>
                    </td>
                    <td className="space-x-3 px-5 py-3 text-right">
                      <button onClick={() => setAssigning(s)} disabled={plans.length === 0} className="font-medium text-ink-700 hover:text-ink-950 disabled:cursor-not-allowed disabled:opacity-50">
                        Assign plan
                      </button>
                      <button onClick={() => toggleActive(s)} className="font-medium text-amber-600 hover:text-amber-700">
                        {s.isActive ? "Suspend" : "Reactivate"}
                      </button>
                      <button onClick={() => handleDelete(s)} className="font-medium text-red-600 hover:text-red-700">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {assigning && (
        <AssignPlanModal
          student={assigning}
          plans={plans}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            setAssigning(null);
            load();
          }}
        />
      )}
    </div>
  );
}
