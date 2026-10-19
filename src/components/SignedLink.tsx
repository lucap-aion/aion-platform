import { useEffect, useState, type AnchorHTMLAttributes } from "react";
import { signedUrl } from "@/lib/storage";

// An <a> to a file in a private bucket.
//
// The companion to SignedImage, for the attachment tiles on a claim: the box is
// a link that opens the original, and its href now has to be signed. Until the
// signature comes back the anchor stays inert rather than navigating to a bare
// object path, and it gives up the pointer cursor so a click that would do
// nothing does not look like one that would.
//
// These sit inside .map() callbacks, which is why this is a component and not a
// hook — a list of attachments cannot call one hook per item.

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  bucket: string;
  value: string | null | undefined;
};

export default function SignedLink({ bucket, value, children, className = "", ...a }: Props) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHref(null);
    if (!value) return;
    void signedUrl(bucket, value).then((url) => { if (alive) setHref(url); });
    return () => { alive = false; };
  }, [bucket, value]);

  return (
    <a
      href={href ?? undefined}
      className={`${className}${href ? "" : " pointer-events-none opacity-70"}`}
      {...a}
    >
      {children}
    </a>
  );
}
