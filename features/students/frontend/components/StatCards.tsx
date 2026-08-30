export default function StatCards({
  overallPercent,
  totalItems,
  planName,
}: {
  overallPercent: number;
  totalItems: number;
  planName: string;
}) {
  const cards = [
    { label: "Progress", value: `${overallPercent}%` },
    { label: "Available content", value: String(totalItems) },
    { label: "Current plan", value: planName },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{c.label}</p>
          <p className="mt-1.5 font-display text-2xl font-semibold text-ink-950">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
