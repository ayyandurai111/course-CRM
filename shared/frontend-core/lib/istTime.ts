// Live classes are scheduled and run on Indian time (Tamil Nadu / IST),
// regardless of what timezone the admin's laptop or a student's phone
// happens to be set to. A plain `datetime-local` input and
// `.toLocaleString()` both silently use the *device's* local timezone
// instead — so an admin scheduling from a device set to a different
// timezone would actually be booking the class at the wrong instant,
// and a student viewing from a different timezone would see a
// different (wrong) time than the class actually runs at.
//
// India has a single fixed UTC+5:30 offset with no daylight saving, so
// unlike most timezones this can be handled with simple, exact offset
// arithmetic instead of needing a timezone database.
export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Converts a UTC instant (ISO string) into the value a
 * `<input type="datetime-local">` needs to *display* that instant as
 * IST wall-clock time — independent of the browser's own timezone.
 */
export function isoToIstInputValue(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const istMs = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
  const ist = new Date(istMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

/**
 * Takes the raw string out of a `<input type="datetime-local">` that
 * the admin filled in *as IST wall-clock time* (the input is labeled
 * "IST") and converts it to the correct UTC ISO string to send to the
 * backend — regardless of what timezone the admin's own device is set
 * to. This is the IST equivalent of `new Date(value).toISOString()`,
 * which would incorrectly use the browser's local timezone instead.
 */
export function istInputValueToIso(value: string): string {
  // `${value}:00+05:30` is unambiguous: it tells the JS Date parser
  // exactly which real-world instant this wall-clock time refers to,
  // without ever touching the browser's own local timezone.
  const withOffset = `${value}:00+05:30`;
  const date = new Date(withOffset);
  return date.toISOString();
}

/** Returns the current moment as an IST `datetime-local` input value — used as the `min` on scheduling pickers. */
export function nowAsIstInputValue(): string {
  return isoToIstInputValue(new Date().toISOString());
}

/** Formats a UTC instant (ISO string) as IST for display, regardless of the viewer's own device timezone. */
export function formatIst(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: IST_TIMEZONE }).format(date);
}
