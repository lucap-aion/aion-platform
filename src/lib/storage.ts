import { supabase } from "@/integrations/supabase/client";

// Reading files out of buckets that are no longer public.
//
// claims_media, profile_pictures and purchase_receipts held claim photographs,
// customer faces and receipts behind URLs anyone could open — the bucket was
// public, the full URL was stored in the database, and a URL that leaks once
// works for ever. They are private now, which means every read has to be signed.
//
// The awkward part is history: rows already hold full public URLs
// (…/object/public/profile_pictures/<id>/avatar.jpg). Rewriting them is a
// migration we do not need — the path is right there inside the URL. So
// everything here takes "whatever the database holds" and works out the object
// path, whether that is a bare path (what we store now) or a legacy URL.
//
// A URL pointing somewhere else entirely — a brand's own CDN, a Shopify image —
// is returned untouched. Not every avatar in this system came from us.

// The buckets that hold people rather than products. Everything here is read
// through a signature; brand_logos, brand_media and products_media stay public
// because they are the house's own marketing assets.
export const PRIVATE_BUCKETS = new Set(["claims_media", "profile_pictures", "purchase_receipts"]);

const PUBLIC_MARKER = "/object/public/";
const SIGNED_MARKER = "/object/sign/";

// Only this project's own storage is ours to sign. It matters more than it
// sounds: every avatar row on DEV points at PROD's public bucket, so stripping
// the path out of the URL and signing it here would ask dev for a file that
// only exists there — and turn every face in the app into initials. A URL from
// another origin is somebody else's file and is handed over untouched.
const PROJECT_ORIGIN = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).origin; }
  catch { return ""; }
})();

function isOurOrigin(value: string): boolean {
  try { return new URL(value).origin === PROJECT_ORIGIN; } catch { return false; }
}

/** Whatever is stored → the object path inside `bucket`, or null. */
export function storagePath(bucket: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;

  const absolute = /^https?:\/\//i.test(v);
  if (absolute && !isOurOrigin(v)) return null;

  for (const marker of [PUBLIC_MARKER, SIGNED_MARKER]) {
    const needle = `${marker}${bucket}/`;
    const at = v.indexOf(needle);
    if (at !== -1) {
      const rest = v.slice(at + needle.length).split("?")[0];
      try { return decodeURIComponent(rest); } catch { return rest; }
    }
  }

  // Someone else's URL, or another bucket's. Not ours to sign.
  if (/^https?:\/\//i.test(v)) return null;
  if (/^(data|blob):/i.test(v)) return null;

  return v.replace(/^\/+/, "");
}

/** True when the value is a URL we should hand to an <img> unchanged. */
export function isForeignUrl(bucket: string, value: string | null | undefined): boolean {
  if (!value) return false;
  const v = String(value).trim();
  if (/^(data|blob):/i.test(v)) return true;
  if (!/^https?:\/\//i.test(v)) return false;
  return storagePath(bucket, v) === null;
}

// Signed URLs cost a round trip each, and a table of thirty customers would ask
// thirty times for the same faces on every render. Keyed on bucket+path, held a
// little less long than the signature itself lives.
const TTL_SECONDS = 3600;
const REUSE_MS = (TTL_SECONDS - 300) * 1000;
const cache = new Map<string, { url: string; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

export async function signedUrl(
  bucket: string,
  value: string | null | undefined,
  expiresIn = TTL_SECONDS,
): Promise<string | null> {
  if (!value) return null;
  if (isForeignUrl(bucket, value)) return String(value);

  const path = storagePath(bucket, value);
  if (!path) return null;

  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.url;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
      // A missing file is normal — a deleted avatar, an old claim tidied away.
      // Returning null lets the caller fall back to its initials placeholder.
      return null;
    }
    cache.set(key, { url: data.signedUrl, at: Date.now() });
    return data.signedUrl;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** Forget a signature — after replacing a file at the same path. */
export function forgetSignedUrl(bucket: string, value: string | null | undefined): void {
  const path = storagePath(bucket, value);
  if (path) cache.delete(`${bucket}/${path}`);
}
