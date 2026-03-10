/** Formats a date string as "12 Jan 2024". Returns "—" for null/undefined. */
export const fmtDate = (value: string | null | undefined): string => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
