import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import { formatIst } from "../../../../shared/frontend-core/lib/istTime";
import { ErrorState } from "../../../../shared/frontend-core/components/common/States";
import { StatCardsSkeleton, ListRowsSkeleton } from "../../../../shared/frontend-core/components/common/Skeleton";

interface Overview {
  studentCount: number;
  courseCount: number;
  publishedContent: number;
  scheduledContent: number;
  draftContent: number;
  activeSubscriptions: number;
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: { name: string; email: string };
}

export default function OverviewSection() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [o, l] = await Promise.all([
        apiRequest<Overview>("/admin/overview"),
        apiRequest<{ logs: AuditLog[] }>("/admin/audit-logs"),
      ]);
      setOverview(o);
      setLogs(l.logs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the overview.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!overview && !error) {
    return (
      <div>
        <h1 className="font-display text-xl font-semibold text-ink-950">Overview</h1>
        <div className="mt-5">
          <StatCardsSkeleton count={6} />
        </div>
        <h2 className="mt-8 font-display text-lg font-semibold text-ink-950">Recent admin activity</h2>
        <div className="mt-3">
          <ListRowsSkeleton />
        </div>
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!overview) return null;

  const cards = [
    { label: "Students", value: overview.studentCount },
    { label: "Courses", value: overview.courseCount },
    { label: "Published content", value: overview.publishedContent },
    { label: "Scheduled", value: overview.scheduledContent },
    { label: "Drafts", value: overview.draftContent },
    { label: "Active subscriptions", value: overview.activeSubscriptions },
  ];

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink-950">Overview</h1>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{c.label}</p>
            <p className="mt-1.5 font-display text-2xl font-semibold text-ink-950">{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold text-ink-950">Recent admin activity</h2>
      <div className="mt-3 divide-y divide-ink-900/8 rounded-xl2 border border-ink-900/8 bg-white shadow-card">
        {logs && logs.length === 0 && <p className="px-5 py-6 text-sm text-ink-500">No admin actions recorded yet.</p>}
        {logs?.slice(0, 10).map((log) => (
          <div key={log.id} className="flex items-center justify-between px-5 py-3 text-sm">
            <div>
              <span className="font-medium text-ink-900">{log.actor.name}</span>{" "}
              <span className="text-ink-500">{log.action.replace(".", " → ")}</span>
            </div>
            <span className="text-xs text-ink-300">{formatIst(log.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
