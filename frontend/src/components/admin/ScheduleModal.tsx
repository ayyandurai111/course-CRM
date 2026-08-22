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
  const [value, setValue] = useState(
    content.scheduledAt ? new Date(content.scheduledAt).toISOString().slice(0, 16) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isReschedule = content.status === "SCHEDULED";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // The <input type="datetime-local"> value has no timezone — it's
      // interpreted in the browser's local timezone, then sent as a
      // real ISO instant so the server always stores UTC.
      const scheduledAt = new Date(value).toISOString();
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
