import { useEffect, useRef, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  content: string;
  title: string;
  streaming?: boolean;
  onClose: () => void;
  onChange: (content: string) => void;
  onTitleChange: (title: string) => void;
  onWidthChange?: (w: number) => void;
};

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 520;

export function NotePanel({ open, content, title, streaming, onClose, onChange, onTitleChange, onWidthChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("note-panel-width");
      return saved ? Math.max(MIN_WIDTH, parseInt(saved)) : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { localStorage.setItem("note-panel-width", String(width)); } catch { /* ignore */ }
    onWidthChange?.(width);
  }, [width]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const maxWidth = window.innerWidth * 0.9;
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      style={{ width }}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 flex flex-col bg-card border-l border-border shadow-lg transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
        {/* Drag-to-resize handle */}
        <div
          onMouseDown={startResize}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 transition-colors"
        />

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Untitled note"
            className="flex-1 text-[14px] font-medium bg-transparent outline-none text-foreground placeholder:text-muted-foreground min-w-0"
          />
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors shrink-0"
            aria-label="Copy"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content area */}
        <div className="relative flex-1 overflow-y-auto">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            readOnly={streaming}
            placeholder="Your note will appear here…"
            className="w-full min-h-full p-6 text-[15px] leading-[1.85] bg-transparent resize-none outline-none text-foreground font-[inherit]"
          />
          {streaming && (
            <div className="absolute inset-0 pointer-events-none note-shimmer" />
          )}
        </div>
    </div>
  );
}
