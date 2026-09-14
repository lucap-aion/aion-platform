import type React from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Held shut until the caller says otherwise — a typed-in name, for instance. */
  confirmDisabled?: boolean;
  /** Anything the confirmation needs to ask for before it will proceed. */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const ConfirmDialog = ({ open, title, description, confirmLabel = "Delete", confirmDisabled, children, onConfirm, onCancel, loading }: Props) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            {children && <div className="mt-3">{children}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-60 transition-colors"
          >
            {loading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
