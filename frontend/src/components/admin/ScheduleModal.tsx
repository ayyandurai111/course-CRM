import { useState, FormEvent } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { ContentItem } from "../../types";

export default function ScheduleModal({
  content,
  onClose,
  onSaved,
}: {
  content: ContentItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  function toLocalDateTimeInput(iso?: string | null) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // The backend rejects any scheduledAt that isn't strictly in the
  // future (see backend/src/lib/dateValidation.js). Without this, the
  // picker happily let an admin choose yesterday, they'd fill out the
  // whole form, and only find out it was invalid after submitting. This
  // min stops the picker from offering past date/times at all, so the
  // mismatch between what the UI allows and what the API accepts can't
  // happen. Recomputed fresh each render so it stays accurate if the
  // modal is left open across a minute boundary.
  const minDateTime = toLocalDateTimeInput(new Date().toISOString());

  const [value, setValue] = useState(() => toLocalDateTimeInput(content.scheduledAt));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isReschedule = content.status === "SCHEDULED";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (!value) {
        setError("Choose a publish date and time.");
        return;
      }
      const localDate = new Date(value);
      if (Number.isNaN(localDate.getTime())) {
        setError("Choose a valid publish date and time.");
        return;
      }
      if (localDate.getTime() <= Date.now()) {
        setError("Choose a date and time in the future.");
        return;
      }
      // datetime-local is interpreted in the browser's local timezone.
      const scheduledAt = localDate.toISOString();
      await apiRequest(`/content/${content.id}/${isReschedule ? "reschedule" : "schedule"}`, {
        method: "POST",
        body: { scheduledAt },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't schedule this content.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isReschedule ? "Reschedule content" : "Schedule content"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-ink-500">
          "{content.title}" will publish automatically at the time you choose, in your local timezone.
        </p>
        <Field label="Publish date & time" htmlFor="sch-time">
          <input
            id="sch-time"
            type="datetime-local"
            required
            min={minDateTime}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
        </Field>
        {error && <p className="mb-4 text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-medium text-ink-700">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Saving…" : "Confirm schedule"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
