interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}

export const FormField = ({ label, required, hint, children }: FieldProps) => (
  <div className="space-y-1.5">
    <label className="text-sm font-medium text-foreground">
      {label}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
  </div>
);

const base = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-muted disabled:cursor-not-allowed";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = (props: InputProps) => <input {...props} className={`${base} ${props.className ?? ""}`} />;

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}
export const Select = ({ children, ...props }: SelectProps) => (
  <div className="relative">
    <select {...props} className={`${base} appearance-none pr-9 ${props.className ?? ""}`}>{children}</select>
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </span>
  </div>
);

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
// Vertically resizable: several of these hold a paragraph or a JSON array of seventeen FAQ
// entries, and `resize-none` meant reading them four lines at a time with no way to open
// them up. Horizontal resize stays off — that one only ever breaks the layout.
export const TextArea = (props: TextAreaProps) => (
  <textarea {...props} rows={props.rows ?? 3} className={`${base} resize-y ${props.className ?? ""}`} />
);

interface SaveBarProps {
  onCancel: () => void;
  loading?: boolean;
  label?: string;
  /** What the left-hand button says. "Cancel" means dismiss; "Discard changes" means revert. */
  cancelLabel?: string;
  /** Nothing to cancel, so the button says so rather than pretending. */
  cancelDisabled?: boolean;
  /** A word about the state of the form, next to the buttons. */
  note?: string;
}
// Sticky, because the form it closes is long enough that the save button was off-screen for
// most of the editing — and a save you have to go looking for is a save people skip.
export const SaveBar = ({ onCancel, loading, label = "Save", cancelLabel = "Cancel", cancelDisabled, note }: SaveBarProps) => (
  <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
    {note && <span className="mr-auto text-xs text-muted-foreground">{note}</span>}
    <button
      type="button"
      onClick={onCancel}
      disabled={cancelDisabled}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
    >
      {cancelLabel}
    </button>
    <button
      type="submit"
      disabled={loading}
      className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
    >
      {loading ? "Saving…" : label}
    </button>
  </div>
);
