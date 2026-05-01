import { memo, useEffect, useRef, useState } from "react";
import { FileText, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { GoogleServiceLogo } from "./GoogleServiceLogo";

type Props = {
  content: string;
  title?: string;
  version?: number;
  collapsed?: boolean;
  streaming?: boolean;
  onChange?: (next: string) => void;
  onSendByEmail?: () => void;
};

function CanvasBlockImpl({ content, title, version, collapsed, streaming, onChange }: Props) {
  const [copied, setCopied] = useState(false);
  // Older canvases default to collapsed; user can expand to peek at the previous version.
  const [open, setOpen] = useState(!collapsed);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // If `collapsed` changes (e.g. a new canvas arrives), auto-collapse old ones once.
  useEffect(() => {
    setOpen(!collapsed);
  }, [collapsed]);

  // Auto-resize height to content when expanded.
  useEffect(() => {
    if (!open) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content, open]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const headerLabel = title && title.trim().length > 0 ? title : "Document";
  const isCollapsed = collapsed === true;

  return (
    <div
      className={`mt-3 mb-1 mx-auto w-[92%] rounded-xl border border-border overflow-hidden transition-colors ${
        isCollapsed ? "bg-muted/40 opacity-75" : "bg-card"
      }`}
    >
      <button
        type="button"
        onClick={() => isCollapsed && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 border-b border-border ${
          isCollapsed ? "bg-muted/30 cursor-pointer hover:bg-muted/50" : "bg-muted/30 cursor-default"
        }`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground min-w-0">
          {isCollapsed ? (
            open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <FileText className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className={`truncate ${isCollapsed ? "" : "text-foreground"}`}>{headerLabel}</span>
          {typeof version === "number" && version > 0 && (
            <span className="shrink-0 inline-flex items-center h-4 px-1.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
              V{version}
            </span>
          )}
          {streaming && !isCollapsed && (
            <span className="text-shimmer font-medium">· updating…</span>
          )}
        </div>
        {!isCollapsed && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy"}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </span>
        )}
      </button>
      {open && (
        <textarea
          ref={taRef}
          value={content}
          readOnly={!onChange}
          onChange={(e) => onChange?.(e.target.value)}
          spellCheck
          className="w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed text-foreground outline-none focus:ring-0 border-0 font-[inherit] min-h-[80px]"
        />
      )}
    </div>
  );
}

export const CanvasBlock = memo(CanvasBlockImpl);
