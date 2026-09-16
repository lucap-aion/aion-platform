import { useRef, useState } from "react";
import { PRIVATE_BUCKETS, forgetSignedUrl } from "@/lib/storage";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, ImageIcon } from "lucide-react";

// A light chequerboard, so a white logo on a transparent background is visible rather than
// being an empty box that reads as a failed upload.
const CHEQUER =
  "linear-gradient(45deg, #e9e9e9 25%, transparent 25%), " +
  "linear-gradient(-45deg, #e9e9e9 25%, transparent 25%), " +
  "linear-gradient(45deg, transparent 75%, #e9e9e9 75%), " +
  "linear-gradient(-45deg, transparent 75%, #e9e9e9 75%)";

interface ImageUploadProps {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  bucket: string;
  /** Path without extension, e.g. "brands/42" */
  path: string;
  disabled?: boolean;
  previewShape?: "square" | "round";
}

export const ImageUpload = ({
  value,
  onChange,
  bucket,
  path,
  disabled,
  previewShape = "square",
}: ImageUploadProps) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const fullPath = `${path}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(fullPath, file, { upsert: true });
      if (upErr) throw upErr;
      if (PRIVATE_BUCKETS.has(bucket)) {
        // Private buckets keep the path; it is signed at read time. The ?t=
        // cache-buster below belongs to a public URL and would break a path.
        forgetSignedUrl(bucket, fullPath);
        onChange(fullPath);
      } else {
        const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath);
        onChange(`${data.publicUrl}?t=${Date.now()}`);
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // An avatar and a logo want opposite things. A round avatar is a face: a square box, and
  // cropping to fill it is right. A logo is a wordmark of unknown proportions: a wide box, and
  // cropping it is how you end up unable to tell whether it is the right logo at all.
  const round = previewShape === "round";
  const shapeClass = round ? "rounded-full h-16 w-16" : "rounded-lg h-16 w-32";
  const fitClass = round ? "h-full w-full object-cover" : "max-h-full max-w-full object-contain";

  return (
    <div className="flex items-center gap-4">
      {/* Preview.
          `object-cover` in a 64px square, which is what this was, crops a logo to its middle:
          a brand wordmark is around 6:1, so all anybody saw of PRADA's logo was a slice of the
          A. "Both logos cannot be opened and I cannot check if they are correct" was exactly
          that — the file was right and the preview could not show it.
          So: contain, not cover; a wide box, because a wordmark is wide; a chequerboard behind
          it, because these arrive transparent and half of them are white; and the whole thing
          is a link, because the only way to really check a logo is to open it. */}
      <div className="relative shrink-0">
        <a
          href={value || undefined}
          target="_blank"
          rel="noreferrer"
          title={value ? "Open the full-size file" : undefined}
          onClick={(e) => { if (!value) e.preventDefault(); }}
          className={`flex items-center justify-center overflow-hidden border border-border ${shapeClass} ${value ? "cursor-zoom-in" : "cursor-default"}`}
          style={value && !round ? { backgroundColor: "#fff", backgroundImage: CHEQUER, backgroundSize: "12px 12px", backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px" } : undefined}
        >
          {value ? (
            <img src={value} alt="" className={fitClass} />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-muted">
              <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
            </span>
          )}
        </a>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-white shadow-md hover:bg-destructive/80 transition-colors z-10"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Upload button */}
      {!disabled && (
        <div className="space-y-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : value ? "Change" : "Upload image"}
          </button>
          <p className="text-xs text-muted-foreground/70">PNG, JPG, WebP accepted</p>
        </div>
      )}
    </div>
  );
};
