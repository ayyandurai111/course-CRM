import { useEffect } from "react";
import { XIcon } from "../common/Icons";

export default function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-xl2 ${maxWidth}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink-900/8 px-5 py-4 sm:px-6">
          <h2 className="font-display text-lg font-semibold text-ink-950">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
