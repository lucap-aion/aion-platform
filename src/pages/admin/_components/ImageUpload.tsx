import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, ImageIcon } from "lucide-react";

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
      const { data } = supabase.storage.from(bucket).getPublicUrl(fullPath);
      onChange(`${data.publicUrl}?t=${Date.now()}`);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const shapeClass = previewShape === "round" ? "rounded-full" : "rounded-lg";

  return (
    <div className="flex items-center gap-4">
      {/* Preview */}
      <div className="relative shrink-0 h-16 w-16">
        <div className={`h-16 w-16 border border-border ${shapeClass} overflow-hidden bg-secondary flex items-center justify-center`}>
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground/50" />
          )}
        </div>
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
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-60"
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
