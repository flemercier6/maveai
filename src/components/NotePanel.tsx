import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("note-panel-width");
      return saved ? Math.max(MIN_WIDTH, parseInt(saved)) : DEFAULT_WIDTH;
    } catch { return DEFAULT_WIDTH; }
  });
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const effectiveWidth = isMobile ? viewportWidth : width;

  // Block-level editing: only the clicked block becomes a textarea, the rest stay
  // rendered as markdown. editingBlock is the index of the block currently being
  // edited, or null when no block is in edit mode.
  const [editingBlock, setEditingBlock] = useState<number | null>(null);
  const blockTextareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Selection toolbar state
  const [selInfo, setSelInfo] = useState<SelInfo | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [askValue, setAskValue] = useState("");

  useEffect(() => {
    try { localStorage.setItem("note-panel-width", String(width)); } catch { /* ignore */ }
  }, [width]);

  useEffect(() => {
    onWidthChange?.(effectiveWidth);
  }, [effectiveWidth, onWidthChange]);

  // Streaming → exit block edit mode and dismiss any open toolbar
  useEffect(() => {
    if (streaming) {
      setEditingBlock(null);
      setSelInfo(null);
      setAskMode(false);
    }
  }, [streaming]);

  // Split content into paragraph-level blocks (separator = one or more blank lines).
  // Empty content yields a single empty block so the user has a click target.
  const blocks = useMemo(() => {
    if (!content) return [""];
    return content.split(/\n{2,}/);
  }, [content]);

  const updateBlock = (i: number, val: string) => {
    const next = blocks.slice();
    next[i] = val;
    onChange(next.join("\n\n"));
  };

  // Focus + size the textarea when we enter edit mode. preventScroll keeps the
  // panel anchored at the clicked position (fixes the scroll-to-top issue).
  useEffect(() => {
    if (editingBlock === null) return;
    const ta = blockTextareaRef.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [editingBlock]);

  // Keep the textarea sized to its content as the user types.
  useEffect(() => {
    if (editingBlock === null) return;
    const ta = blockTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [content, editingBlock]);

  // Dismiss toolbar on click / tap outside.
  useEffect(() => {
    if (!selInfo) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = (e.target as Node) ?? null;
      if (!barRef.current?.contains(target)) {
        setSelInfo(null);
        setAskMode(false);
        setAskValue("");
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [selInfo]);

  // Document-level selection capture — works for both the block-edit textarea
  // and the rendered markdown preview (uses window.getSelection).
  useEffect(() => {
    if (!open || streaming) return;

    const capture = (mouseEvent: MouseEvent | null) => {
      if (mouseEvent && barRef.current?.contains(mouseEvent.target as Node)) return;

      // Block edit mode: textarea selection. We store start=-1 so applyFormat
      // falls back to content.indexOf() — positions inside a single block
      // would otherwise need conversion to absolute content offsets.
      const blockTa = blockTextareaRef.current;
      if (blockTa && editingBlock !== null) {
        const s = blockTa.selectionStart;
        const e = blockTa.selectionEnd;
        if (s !== e) {
          const text = blockTa.value.slice(s, e);
          const x = mouseEvent?.clientX ?? blockTa.getBoundingClientRect().left + 120;
          const y = mouseEvent?.clientY ?? blockTa.getBoundingClientRect().top + 40;
          setSelInfo({ text, start: -1, end: -1, x, y });
          setAskMode(false);
          setAskValue("");
          return;
        }
      }

      // Preview mode: document selection inside the rendered markdown
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const text = sel.toString().trim();
      if (!text) return;

      const preview = previewRef.current;
      if (!preview) return;
      if (!preview.contains(sel.anchorNode) || !preview.contains(sel.focusNode)) return;

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      setSelInfo({
        text,
        start: -1,
        end: -1,
        x: mouseEvent ? mouseEvent.clientX : rect.left + rect.width / 2,
        y: rect.top,
      });
      setAskMode(false);
      setAskValue("");
    };

    const onMouseUp = (e: MouseEvent) => setTimeout(() => capture(e), 0);
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const synthetic = t
        ? ({ clientX: t.clientX, clientY: t.clientY, target: e.target } as MouseEvent)
        : null;
      setTimeout(() => capture(synthetic), 60);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) {
        setTimeout(() => capture(null), 0);
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [open, streaming, editingBlock]);

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

  const applyFormat = (marker: string) => {
    if (!selInfo) return;
    const { start, end, text } = selInfo;
    if (start >= 0) {
      onChange(content.slice(0, start) + marker + text + marker + content.slice(end));
    } else {
      const idx = content.indexOf(text);
      if (idx >= 0) {
        onChange(content.slice(0, idx) + marker + text + marker + content.slice(idx + text.length));
      }
    }
    setSelInfo(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleAskSubmit = () => {
    if (!selInfo || !askValue.trim()) return;
    onAskChange?.(selInfo.text, askValue.trim());
    setSelInfo(null);
    setAskMode(false);
    setAskValue("");
  };

  return (
    <div
      style={{ width: effectiveWidth, maxWidth: "100vw" }}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 bg-sidebar",
        isMobile ? "p-0" : "pt-[10px] pr-[10px] pb-[10px] pl-0",
        "transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      {!isMobile && (
        <div
          onMouseDown={startResize}
          className="absolute left-0 top-0 bottom-0 w-[10px] cursor-col-resize"
        />
      )}

      <div className={cn(
        "flex flex-col h-full overflow-hidden bg-sidebar",
        isMobile ? "rounded-none" : "rounded-[12px]",
      )}>
        <div className={cn("flex items-center gap-2 shrink-0", isMobile ? "px-3 py-2.5" : "px-4 py-3")}>
          <button
            onClick={onClose}
            className={cn(
              "rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors shrink-0",
              isMobile ? "p-2" : "p-1.5",
            )}
            aria-label="Close"
          >
            <X className={isMobile ? "w-5 h-5" : "w-4 h-4"} />
          </button>
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Untitled note"
            className="flex-1 text-[14px] font-medium bg-transparent outline-none text-foreground placeholder:text-muted-foreground min-w-0"
          />
          <button
            onClick={handleCopy}
            className={cn(
              "rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors shrink-0",
              isMobile ? "p-2" : "p-1.5",
            )}
            aria-label="Copy"
          >
            {copied ? <Check className={isMobile ? "w-5 h-5" : "w-4 h-4"} /> : <Copy className={isMobile ? "w-5 h-5" : "w-4 h-4"} />}
          </button>
        </div>

        {/* Content area — markdown rendered always; one block at a time can swap
            to a raw textarea while every other block keeps its formatting. */}
        <div className="relative flex-1 overflow-y-auto">
          <div
            ref={previewRef}
            className={cn(
              "chat-prose text-[15px]",
              streaming ? "" : "cursor-text",
              isMobile ? "p-4" : "p-6",
            )}
          >
            {blocks.length === 1 && !blocks[0] && !streaming ? (
              <p
                className="text-muted-foreground"
                onClick={() => setEditingBlock(0)}
              >
                Your note will appear here…
              </p>
            ) : (
              blocks.map((block, i) =>
                !streaming && editingBlock === i ? (
                  <textarea
                    key={`edit-${i}`}
                    ref={blockTextareaRef}
                    value={block}
                    onChange={(e) => updateBlock(i, e.target.value)}
                    onBlur={(e) => {
                      if (barRef.current?.contains(e.relatedTarget as Node)) return;
                      setEditingBlock(null);
                    }}
                    className="w-full resize-none outline-none bg-transparent text-[15px] leading-[1.85] font-[inherit] text-foreground my-2 block"
                    style={{ overflow: "hidden" }}
                  />
                ) : (
                  <div
                    key={`view-${i}`}
                    onClick={(e) => {
                      if (streaming) return;
                      const sel = window.getSelection();
                      if (sel && !sel.isCollapsed && sel.toString().trim()) return;
                      if (barRef.current?.contains(e.target as Node)) return;
                      setEditingBlock(i);
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {block || "​"}
                    </ReactMarkdown>
                  </div>
                ),
              )
            )}
            {streaming && (
              <span
                aria-hidden
                className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-muted-foreground/60 animate-pulse rounded-sm"
              />
            )}
          </div>
        </div>
      </div>

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
