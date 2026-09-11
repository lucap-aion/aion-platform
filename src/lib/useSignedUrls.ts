import { useEffect, useState } from "react";
import { signedUrl } from "./storage";

// Sign a whole list at once, keyed on what the database holds.
//
// For a component that shows the same files in several shapes — a thumbnail, a
// PDF <embed>, a lightbox — one hook at the top beats a signing component at
// each spot, and it is the only option for <embed>, which has no children to
// wrap. Values that cannot be signed are simply absent from the map, so callers
// fall back the same way they would for a missing file.
export function useSignedUrls(bucket: string, values: (string | null | undefined)[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  // The list identity changes on every render; its contents rarely do.
  const key = values.filter(Boolean).join("|");

  useEffect(() => {
    let alive = true;
    const list = key ? key.split("|") : [];
    if (!list.length) { setMap({}); return; }
    void Promise.all(list.map(async (v) => [v, await signedUrl(bucket, v)] as const))
      .then((pairs) => {
        if (!alive) return;
        setMap(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => Boolean(p[1]))));
      });
    return () => { alive = false; };
  }, [bucket, key]);

  return map;
}
