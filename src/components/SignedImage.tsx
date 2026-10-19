import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { signedUrl } from "@/lib/storage";

// A drop-in <img> for a file in a private bucket.
//
// The buckets holding claim photographs and customer faces are no longer
// public, so their URLs have to be signed, and signing is asynchronous — which
// an <img src> cannot express on its own. This does the asking, survives the
// component unmounting mid-flight, and renders nothing at all if the file has
// gone, so the caller's initials placeholder shows through instead of a broken
// image icon.
//
// `value` is whatever the database holds: a bare object path (what we store
// now), a legacy public URL, or somebody else's URL entirely. All three work.

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bucket: string;
  value: string | null | undefined;
  /** Rendered while signing, and if the file cannot be read. */
  fallback?: React.ReactNode;
};

export default function SignedImage({ bucket, value, fallback = null, alt = "", ...img }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (!value) return;
    void signedUrl(bucket, value).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [bucket, value]);

  if (!src) return <>{fallback}</>;
  return <img src={src} alt={alt} {...img} />;
}
