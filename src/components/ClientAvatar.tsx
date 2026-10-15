import { useEffect, useState } from "react";
import { User } from "lucide-react";
import SignedImage from "@/components/SignedImage";
import { cn } from "@/lib/utils";

// A client's face, or their initials when there is no face to show.
//
// Most clients have no photo — on DEV 19 of ~1,200 do — so the monogram is the
// normal case, not the fallback, and it is drawn on purpose: a small circle in
// the brand's tint with the initials in it. What it must never be is a blank
// box the size of a photograph, which is what a list of ten clients used to
// look like. The same circle covers every way a photo can be missing: no value
// at all, a file that cannot be signed (SignedImage renders its fallback), and
// an image that fails to load (onError) — never a broken-image icon.
//
// `value` is whatever the database holds for `avatar`: a bucket path, a legacy
// public URL, or a foreign URL. SignedImage works out which.

export const clientInitials = (name?: string | null, email?: string | null): string => {
  const words = (name ?? "").trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length) {
    const first = words[0].match(/\p{L}/u)?.[0] ?? "";
    const last = words.length > 1 ? words[words.length - 1].match(/\p{L}/u)?.[0] ?? "" : "";
    return (first + last).toUpperCase();
  }
  const e = (email ?? "").trim().match(/\p{L}/u)?.[0];
  return e ? e.toUpperCase() : "";
};

type Props = {
  name?: string | null;
  email?: string | null;
  value?: string | null;
  /** Size and type scale, e.g. "h-10 w-10 text-sm". */
  className?: string;
};

export default function ClientAvatar({ name, email, value, className }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [value]);

  const initials = clientInitials(name, email);
  const monogram = initials
    ? <span aria-hidden className="select-none leading-none tracking-wide">{initials}</span>
    : <User aria-hidden className="h-1/2 w-1/2" />;
  const src = typeof value === "string" && value.trim() ? value.trim() : null;

  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-xs font-semibold text-primary",
        className,
      )}
    >
      {src && !failed ? (
        <SignedImage
          bucket="profile_pictures"
          value={src}
          alt={name ?? ""}
          loading="lazy"
          // Foreign avatars are hotlinked; see ProductCard in BrandAssistant.
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          fallback={monogram}
          onError={() => setFailed(true)}
        />
      ) : monogram}
    </div>
  );
}
