import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, ArrowRight } from "lucide-react";
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
  onAskChange?: (selection: string, request: string) => void;
};

type SelInfo = { text: string; start: number; end: number; x: number; y: number };

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 520;

export function NotePanel({ open, content, title, streaming, onClose, onChange, onTitleChange, onWidthChange, onAskChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("note-panel-width");
      return saved ? Math.max(MIN_WIDTH, parseInt(saved)) : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Snapshot of content at the moment streaming starts.
  const prevContentRef = useRef<string>("");
  const streamingActiveRef = useRef<boolean>(false);

  // Selection toolbar state
  const [selInfo, setSelInfo] = useState<SelInfo | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [askValue, setAskValue] = useState("");

  useEffect(() => {
    try { localStorage.setItem("note-panel-width", String(width)); } catch { /* ignore */ }
    onWidthChange?.(width);
  }, [width]);

  // Capture pre-edit snapshot when streaming begins.
  useEffect(() => {
    if (streaming && !streamingActiveRef.current) {
      prevContentRef.current = content;
      streamingActiveRef.current = true;
    }
    if (!streaming) {
      streamingActiveRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Dismiss toolbar when streaming starts.
  useEffect(() => {
    if (streaming) { setSelInfo(null); setAskMode(false); }
  }, [streaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [content]);

  // Dismiss toolbar on click outside.
  useEffect(() => {
    if (!selInfo) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) {
        setSelInfo(null);
        setAskMode(false);
        setAskValue("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selInfo]);

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

  const readSelection = (el: HTMLTextAreaElement, x: number, y: number) => {
    const { selectionStart: start, selectionEnd: end } = el;
    if (start !== end) {
      setSelInfo({ text: el.value.slice(start, end), start, end, x, y });
      setAskMode(false);
      setAskValue("");
    } else {
      setSelInfo(null);
      setAskMode(false);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) =>
    readSelection(e.currentTarget, e.clientX, e.clientY);

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    readSelection(el, rect.left + rect.width / 2, rect.top + 40);
  };

  const applyFormat = (marker: string) => {
    if (!selInfo) return;
    const { start, end, text } = selInfo;
    onChange(content.slice(0, start) + marker + text + marker + content.slice(end));
    setSelInfo(null);
  };

  const handleAskSubmit = () => {
    if (!selInfo || !askValue.trim()) return;
    onAskChange?.(selInfo.text, askValue.trim());
    setSelInfo(null);
    setAskMode(false);
    setAskValue("");
  };

  // Line-by-line streaming view.
  const renderStreaming = () => {
    const newLines = content.split("\n");
    const oldLines = prevContentRef.current ? prevContentRef.current.split("\n") : [];
    const completedLines = newLines.slice(0, -1);
    const currentLine = newLines[newLines.length - 1] ?? "";
    const remainingOldLines = oldLines.slice(newLines.length);

    return (
      <div className="w-full min-h-full p-6 text-[15px] leading-[1.85] font-[inherit]">
        {completedLines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap text-foreground" style={{ minHeight: "1.85em" }}>
            {line || " "}
          </div>
        ))}
        <div className="whitespace-pre-wrap" style={{ minHeight: "1.85em" }}>
          <span className="text-shimmer">{currentLine || " "}</span>
        </div>
        {remainingOldLines.map((line, i) => (
          <div key={`r${i}`} className="whitespace-pre-wrap text-muted-foreground opacity-50" style={{ minHeight: "1.85em" }}>
            {line || " "}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{ width }}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 bg-sidebar pt-[10px] pr-[10px] pb-[10px] pl-0",
        "transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      {/* Drag-to-resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 bottom-0 w-[10px] cursor-col-resize"
      />

      {/* Inner panel */}
      <div className="flex flex-col h-full rounded-[12px] overflow-hidden bg-sidebar">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
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
        </div>

        {/* Content area */}
        <div className="relative flex-1 overflow-y-auto">
          {streaming ? renderStreaming() : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onChange(e.target.value)}
              onMouseUp={handleMouseUp}
              onKeyUp={handleKeyUp}
              placeholder="Your note will appear here…"
              className="w-full min-h-full p-6 text-[15px] leading-[1.85] bg-transparent resize-none outline-none text-foreground font-[inherit]"
            />
          )}
        </div>
      </div>

      {/* Floating selection toolbar — portaled to body to escape the CSS transform context */}
      {selInfo && !streaming && createPortal(
        <div
          ref={barRef}
          style={{
            position: "fixed",
            left: Math.min(Math.max(selInfo.x, askMode ? 140 : 95), window.innerWidth - (askMode ? 140 : 95)),
            top: Math.max(8, selInfo.y - 52),
            transform: "translateX(-50%)",
            zIndex: 9999,
          }}
          className="flex items-center gap-0.5 rounded-[10px] bg-card border border-border shadow-md px-1.5 py-1"
        >
          {askMode ? (
            <>
              <input
                ref={askInputRef}
                autoFocus
                value={askValue}
                onChange={(e) => setAskValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAskSubmit();
                  if (e.key === "Escape") { setAskMode(false); setAskValue(""); }
                }}
                placeholder="Ask for changes…"
                className="text-[13px] bg-transparent outline-none text-foreground w-44 placeholder:text-muted-foreground px-1"
              />
              <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
              <button
                onClick={handleAskSubmit}
                disabled={!askValue.trim()}
                className="p-1.5 rounded-md hover:bg-dropdown-hover text-foreground disabled:opacity-40 transition-colors shrink-0"
                aria-label="Send"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setAskMode(true); setTimeout(() => askInputRef.current?.focus(), 0); }}
                className="text-[12px] font-medium px-2 py-1 rounded-[6px] hover:bg-dropdown-hover text-foreground whitespace-nowrap transition-colors"
              >
                Ask for changes
              </button>
              <div className="w-px h-4 bg-border mx-0.5 shrink-0" />
              <button
                onClick={() => applyFormat("**")}
                className="w-7 h-7 rounded-[6px] hover:bg-dropdown-hover text-foreground flex items-center justify-center font-bold text-[13px] transition-colors"
                aria-label="Bold"
              >
                B
              </button>
              <button
                onClick={() => applyFormat("_")}
                className="w-7 h-7 rounded-[6px] hover:bg-dropdown-hover text-foreground flex items-center justify-center italic text-[13px] transition-colors"
                aria-label="Italic"
              >
                I
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
