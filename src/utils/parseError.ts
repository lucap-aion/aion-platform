/**
 * Translates raw Supabase / PostgreSQL error messages into friendly text
 * suitable for displaying directly to end users.
 */
export function parseError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "Something went wrong. Please try again.";

  const msg = raw.toLowerCase();

  // Duplicate / unique constraint
  if (msg.includes("duplicate key") || msg.includes("unique constraint") || msg.includes("already exists")) {
    // Try to extract the field name from the constraint
    const field = raw.match(/\(([^)]+)\)=/)?.[1];
    if (field === "email") return "This email address is already registered.";
    if (field === "brand_sale_id") return "A cover with this Sale ID already exists.";
    return "This record already exists. Please check for duplicates.";
  }

  // Not-null constraint
  if (msg.includes("null value in column") || msg.includes("not-null constraint") || msg.includes("violates not-null")) {
    const col = raw.match(/column ["']?([^"'\s]+)["']? of/)?.[1] ?? raw.match(/column "([^"]+)"/)?.[1];
    const label = col ? `"${col.replace(/_/g, " ")}"` : "a required field";
    return `Please fill in ${label} before saving.`;
  }

  // Foreign key violation (delete blocked by references)
  if (msg.includes("foreign key") || msg.includes("violates foreign key constraint")) {
    if (msg.includes("delete") || msg.includes("update")) {
      return "This record is linked to other data and cannot be deleted.";
    }
    return "The selected item no longer exists. Please refresh and try again.";
  }

  // Row-level security / permissions
  if (
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("new row violates") ||
    msg.includes("insufficient privilege")
  ) {
    return "You don't have permission to perform this action.";
  }

  // JWT / session expired
  if (msg.includes("jwt expired") || msg.includes("token is expired") || msg.includes("invalid jwt")) {
    return "Your session has expired. Please sign in again.";
  }

  // Network / connection
  if (
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror")
  ) {
    return "Connection failed. Please check your internet and try again.";
  }

  // Value too long
  if (msg.includes("value too long") || msg.includes("character varying")) {
    return "One of the values you entered is too long.";
  }

  // Invalid type / format
  if (msg.includes("invalid input syntax") || msg.includes("invalid value")) {
    return "One of the values has an invalid format. Please double-check your input.";
  }

  // Conflict / already used
  if (msg.includes("conflict")) {
    return "There was a conflict saving your changes. Please refresh and try again.";
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "The request took too long. Please try again.";
  }

  // Generic fallback — strip any schema/table names from the raw message
  const cleaned = raw
    .replace(/\b(public|supabase|postgres|pg|relation|table|column|constraint|index)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned.length > 0 && cleaned.length < 120
    ? cleaned
    : "Something went wrong. Please try again or contact support.";
}
