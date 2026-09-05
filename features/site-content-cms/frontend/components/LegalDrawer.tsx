import { useEffect } from "react";
import { XIcon } from "../../../../shared/frontend-core/components/common/Icons";

export default function LegalDrawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink-950/40"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink-950">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-ink-500 hover:bg-ink-100"
            aria-label={`Close ${title}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="prose prose-sm max-w-none text-ink-700">{children}</div>
      </div>
    </div>
  );
}
