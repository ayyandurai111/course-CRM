import { useState, FormEvent } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { indiaDateTimeLocalToIso, nowIndiaDateTimeLocal, toIndiaDateTimeLocal, APP_TIME_ZONE_LABEL } from "../../lib/dateTime";

export default function ScheduleModal({
  content,
  onClose,
  onSaved,
}: {
  content: ContentItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The picker is always shown in India Standard Time (IST), regardless of the
  // browser/server timezone. The API still receives an explicit UTC instant.


  // The backend rejects any scheduledAt that isn't strictly in the
  // future (see backend/src/lib/dateValidation.js). Without this, the
  // picker happily let an admin choose yesterday, they'd fill out the
  // whole form, and only find out it was invalid after submitting. This
  // min stops the picker from offering past date/times at all, so the
  // mismatch between what the UI allows and what the API accepts can't
  // happen. Recomputed fresh each render so it stays accurate if the
  // modal is left open across a minute boundary.
  const minDateTime = nowIndiaDateTimeLocal();

  const [value, setValue] = useState(() => toIndiaDateTimeLocal(content.scheduledAt));
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
      const scheduledAt = indiaDateTimeLocalToIso(value);
      if (!scheduledAt) {
        setError("Choose a valid publish date and time.");
        return;
      }
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        setError("Choose a date and time in the future.");
        return;
      }
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
          "{content.title}" will publish automatically at the time you choose, in India Standard Time (IST).
        </p>
        <Field label={`Publish date & time (${APP_TIME_ZONE_LABEL})`} htmlFor="sch-time">
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
