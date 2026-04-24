import { memo, useEffect, useRef, useState } from "react";
import { FileText, Copy, Check } from "lucide-react";

type Props = {
  content: string;
  streaming?: boolean;
  onChange?: (next: string) => void;
};

function CanvasBlockImpl({ content, streaming, onChange }: Props) {
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize height to content.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mt-3 mb-1 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FileText className="w-3.5 h-3.5" />
          <span>Document</span>
          {streaming && (
            <span className="text-shimmer font-medium">· updating…</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy"}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <textarea
        ref={taRef}
        value={content}
        readOnly={!onChange}
        onChange={(e) => onChange?.(e.target.value)}
        spellCheck
        className="w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed text-foreground outline-none focus:ring-0 border-0 font-[inherit] min-h-[80px]"
      />
    </div>
  );
}

export const CanvasBlock = memo(CanvasBlockImpl);
