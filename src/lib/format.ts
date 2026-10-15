// ==============================|| DISPLAY FORMATTING ||============================== //
// Small helpers for values that are stored as whatever the source gave us and have to be
// shown consistently anyway.

/**
 * A birthdate as `<input type="date">` takes it: `YYYY-MM-DD`, or "" when there is none.
 *
 * `profiles.date_of_birth` is a timestamptz, so the API hands back
 * "1964-11-06T00:00:00+00:00" — which a date input rejects, rendering the field blank
 * for every customer who has one. Older registrations also stored the birthday as
 * midnight in the customer's own zone ("1996-11-08T23:00:00+00:00" is 9 November in
 * Rome), so the date is the nearest UTC midnight, not the first ten characters.
 */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "";
  const DAY = 86_400_000;
  return new Date(Math.round(ms / DAY) * DAY).toISOString().slice(0, 10);
}
