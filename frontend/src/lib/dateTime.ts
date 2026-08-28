/**
 * Course CRM scheduling uses India Standard Time (IST) for the admin/student UI.
 * The API/database still store absolute timestamps (UTC/timestamptz).
 */
export const APP_TIME_ZONE = "Asia/Kolkata";
export const APP_TIME_ZONE_LABEL = "IST";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Convert an ISO instant to the wall-clock value required by datetime-local in IST. */
export function toIndiaDateTimeLocal(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Convert an IST datetime-local value to an unambiguous UTC ISO instant. */
export function indiaDateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  // India has a fixed UTC+05:30 offset (no daylight-saving changes).
  const isoWithIndiaOffset = `${value}:00+05:30`;
  const date = new Date(isoWithIndiaOffset);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatIndiaDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)} IST`;
}

export function formatIndiaDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Current IST wall-clock value for a datetime-local min attribute. */
export function nowIndiaDateTimeLocal(): string {
  return toIndiaDateTimeLocal(new Date().toISOString());
}
