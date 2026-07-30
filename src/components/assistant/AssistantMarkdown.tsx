import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// The assistant's prose, rendered the same way on both surfaces.
//
// The reason this is a component rather than an inline <ReactMarkdown>: a
// product photo inside a markdown table used to render at its natural size —
// a 1000px gown filling one cell, the row a screen tall, and SKU / Name /
// Price pushed down to the bottom of it. Default markdown has no opinion about
// image size, so every image needs one here.

export default function AssistantMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Any image the model emits is a thumbnail, wherever it appears. Click
        // through for the full-size original.
        img: ({ src, alt }) => {
          if (!src) return null;
          return (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="not-prose my-0 inline-block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40 align-middle transition-opacity hover:opacity-80"
            >
              <img
                src={src}
                alt={alt ?? ""}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </a>
          );
        },
        // A wide table scrolls inside its own box instead of stretching the
        // whole conversation column.
        table: ({ children }) => (
          <div className="not-prose my-3 w-full overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
        tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
        th: ({ children }) => (
          <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-foreground">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 align-middle text-muted-foreground">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
