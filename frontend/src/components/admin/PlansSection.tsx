import { useEffect, useState } from "react";
import { apiRequest, ApiError, reportActionError } from "../../lib/apiClient";
import type { Plan } from "../../types";
import { ErrorState, EmptyState } from "../common/States";
import { PlanCardsSkeleton } from "../common/Skeleton";
import PlanFormModal from "./PlanFormModal";
import { PlusIcon } from "../common/Icons";

type AdminPlan = Plan & { _count: { subscriptions: number } };

function formatPrice(cents: number, currency: string) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

export default function PlansSection() {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null | "new">(null);

  async function load() {
    setError(null);
    try {
      const data = await apiRequest<{ plans: AdminPlan[] }>("/plans/admin");
      setPlans(data.plans);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load plans.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string, subCount: number) {
    if (subCount > 0) {
      alert("This plan has active subscribers — deactivate it instead of deleting so their access stays predictable.");
      return;
    }
    if (!confirm("Delete this plan?")) return;
    try {
      await apiRequest(`/plans/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      reportActionError(err, "Couldn't delete this plan.");
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink-950">Plans</h1>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
        >
          <PlusIcon className="h-4 w-4" />
          Add plan
        </button>
      </div>

      {plans === null && !error && <PlanCardsSkeleton />}
      {error && <ErrorState message={error} onRetry={load} />}
      {plans && plans.length === 0 && (
        <EmptyState
          title="No plans yet"
          description="Create a plan and attach courses to it so students can subscribe."
          action={
            <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50">
              <PlusIcon className="h-4 w-4" />
              Add plan
            </button>
          }
        />
      )}

      {plans && plans.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
              <div className="flex items-start justify-between">
                <h3 className="font-display text-base font-semibold text-ink-950">{plan.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${plan.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-ink-100 text-ink-500"}`}>
                  {plan.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="mt-1 font-display text-xl font-semibold text-ink-950">
                {formatPrice(plan.priceCents, plan.currency)}
                <span className="text-sm font-normal text-ink-500"> / {plan.billingPeriod.toLowerCase().replace("_", "-")}</span>
              </p>
              <p className="mt-2 text-xs text-ink-500">
                {plan.planCourses?.length ?? 0} course(s) · {plan._count.subscriptions} active subscriber(s)
              </p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setEditing(plan)} className="text-sm font-medium text-ink-700 hover:text-ink-950">
                  Edit
                </button>
                <button onClick={() => handleDelete(plan.id, plan._count.subscriptions)} className="text-sm font-medium text-red-600 hover:text-red-700">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PlanFormModal
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
