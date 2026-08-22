import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Plan, SiteContent } from "../../types";
import { ErrorState, EmptyState } from "../common/States";
import { PlanCardsSkeleton } from "../common/Skeleton";

function formatPrice(cents: number, currency: string, period: Plan["billingPeriod"]) {
  const amount = (cents / 100).toLocaleString(undefined, { style: "currency", currency });
  if (cents === 0) return "Free";
  const suffix = period === "MONTHLY" ? "/mo" : period === "YEARLY" ? "/yr" : "";
  return `${amount}${suffix}`;
}

export default function PlansSection({ content }: { content: SiteContent["plansSection"] }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setPlans(null);
    try {
      const data = await apiRequest<{ plans: Plan[] }>("/plans");
      setPlans(data.plans);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load plans right now.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section id="plans" className="mx-auto max-w-6xl px-5 py-20">
      <div className="mb-10 max-w-lg">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-amber-600">{content.eyebrow}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-950">
          {content.title}
        </h2>
      </div>

      {plans === null && !error && <PlanCardsSkeleton />}
      {error && <ErrorState message={error} onRetry={load} />}
      {plans && plans.length === 0 && (
        <EmptyState title="Plans are coming soon" description="The admin hasn't published any plans yet." />
      )}

      {plans && plans.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-xl2 border p-6 ${
                plan.isPopular ? "border-ink-950 bg-ink-950 text-paper-50 shadow-card" : "border-ink-900/8 bg-white shadow-card"
              }`}
            >
              {plan.isPopular && (
                <span className="absolute -top-3 left-6 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-ink-950">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
              <p className={`mt-2 font-display text-3xl font-semibold ${plan.isPopular ? "" : "text-ink-950"}`}>
                {formatPrice(plan.priceCents, plan.currency, plan.billingPeriod)}
              </p>
              {plan.description && (
                <p className={`mt-2 text-sm ${plan.isPopular ? "text-ink-300" : "text-ink-500"}`}>{plan.description}</p>
              )}
              {plan.features?.length > 0 && (
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className={plan.isPopular ? "text-amber-400" : "text-amber-600"}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/login"
                className={`mt-6 rounded-full px-4 py-2.5 text-center text-sm font-semibold transition ${
                  plan.isPopular ? "bg-amber-500 text-ink-950 hover:bg-amber-400" : "bg-ink-950 text-paper-50 hover:bg-ink-900"
                }`}
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
