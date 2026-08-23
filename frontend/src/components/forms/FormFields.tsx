import { ReactNode } from "react";

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-ink-900/15 px-3 py-2.5 text-sm outline-none focus:border-ink-950";

export function PrimaryButton({
  children,
  disabled,
  type = "submit",
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className="rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 transition hover:bg-ink-900 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
