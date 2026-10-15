// ==============================|| PROFILE COMPLETION ||============================== //
// What "complete" means on the customer's progress ring. It is the profilation KPI the
// brand is measured on (admin_dashboard_aggregates / AdminInsights: date of birth,
// country, city, postcode, address, province, nationality, phone), plus the name. The
// photo is deliberately left out: it says nothing about the customer. Before this the ring
// counted the photo and the email but none of date of birth, province or nationality, so
// a customer could reach 100% without being profiled.

export const PROFILE_COMPLETION_FIELDS = [
  "first_name",
  "last_name",
  "phone_number",
  "date_of_birth",
  "nationality",
  "address",
  "city",
  "province",
  "country",
  "postcode",
] as const;

export type ProfileCompletionField = (typeof PROFILE_COMPLETION_FIELDS)[number];

type CompletionSource = Partial<Record<ProfileCompletionField, string | null | undefined>>;

/** Whitespace is not an answer — the profilation KPI does not count empty strings either. */
const filled = (v: string | null | undefined) => !!v && v.trim() !== "";

export function missingProfileFields(p: CompletionSource): ProfileCompletionField[] {
  return PROFILE_COMPLETION_FIELDS.filter((f) => !filled(p[f]));
}

export function profileCompletionPct(p: CompletionSource): number {
  const done = PROFILE_COMPLETION_FIELDS.length - missingProfileFields(p).length;
  return Math.round((done / PROFILE_COMPLETION_FIELDS.length) * 100);
}
