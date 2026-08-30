import { useState, FormEvent, useEffect } from "react";
import Modal from "../../../../shared/frontend-core/components/modals/Modal";
import { Field, inputClass, PrimaryButton } from "../../../../shared/frontend-core/components/forms/FormFields";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import type { Plan, Course, BillingPeriod } from "../../../../shared/frontend-core/types/index";

export default function PlanFormModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState(plan?.name ?? "");
  const [price, setPrice] = useState(plan ? (plan.priceCents / 100).toString() : "");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(plan?.billingPeriod ?? "MONTHLY");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [features, setFeatures] = useState(plan?.features?.join("\n") ?? "");
  const [isPopular, setIsPopular] = useState(plan?.isPopular ?? false);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>(
    plan?.planCourses?.map((pc) => pc.course.id) ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<{ courses: Course[] }>("/courses/admin").then((d) => setCourses(d.courses)).catch(() => {});
  }, []);

  function toggleCourse(id: string) {
    setSelectedCourseIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        name,
        priceCents: Math.round(parseFloat(price || "0") * 100),
        billingPeriod,
        description: description || undefined,
        features: features.split("\n").map((f) => f.trim()).filter(Boolean),
        isPopular,
        isActive,
        courseIds: selectedCourseIds,
      };
      if (plan) {
        await apiRequest(`/plans/${plan.id}`, { method: "PATCH", body });
      } else {
        await apiRequest("/plans", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={plan ? "Edit plan" : "New plan"} onClose={onClose} maxWidth="max-w-xl">
      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan name" htmlFor="p-name">
            <input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Price (in your currency, e.g. 499)" htmlFor="p-price">
            <input
              id="p-price"
              type="number"
              min="0"
              step="0.01"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Billing period" htmlFor="p-period">
          <select id="p-period" value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)} className={inputClass}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
            <option value="ONE_TIME">One-time</option>
          </select>
        </Field>

        <Field label="Description" htmlFor="p-desc">
          <textarea id="p-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </Field>

        <Field label="Features (one per line)" htmlFor="p-features">
          <textarea id="p-features" rows={4} value={features} onChange={(e) => setFeatures(e.target.value)} className={inputClass} />
        </Field>

        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-ink-700">Courses this plan unlocks</p>
          <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-ink-900/15 p-3">
            {courses.length === 0 && <p className="text-sm text-ink-500">No courses created yet.</p>}
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" checked={selectedCourseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                {c.title}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-5 flex gap-6">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={isPopular} onChange={(e) => setIsPopular(e.target.checked)} />
            Mark as "Most popular"
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (visible on landing page)
          </label>
        </div>

        {error && <p className="mb-4 text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-medium text-ink-700">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Saving…" : "Save plan"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
