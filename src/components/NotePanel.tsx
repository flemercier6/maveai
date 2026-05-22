import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check, ArrowRight } from "lucide-react";
import { marked } from "marked";
import TurndownService from "turndown";
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

type SelInfo = { text: string; x: number; y: number };

const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 520;

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "_",
  strongDelimiter: "**",
  codeBlockStyle: "fenced",
});

function renderMarkdownToHTML(md: string): string {
  if (!md) return "";
  return marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
}

function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html).trim();
}

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

  const editorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Last markdown we synced into the DOM. We use this to distinguish "external"
  // content changes (which should update the DOM) from "user-typed" changes
  // (which originate from the DOM itself — don't overwrite).
  const lastSyncedRef = useRef<string>("");
  // Whether the editor currently has focus (user mid-edit).
  const focusedRef = useRef<boolean>(false);

  // Selection toolbar state.
  const [selInfo, setSelInfo] = useState<SelInfo | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [askValue, setAskValue] = useState("");

  useEffect(() => {
    try { localStorage.setItem("note-panel-width", String(width)); } catch { /* ignore */ }
  }, [width]);

  useEffect(() => {
    onWidthChange?.(effectiveWidth);
  }, [effectiveWidth, onWidthChange]);

  // Sync DOM with the `content` prop. Runs on mount + whenever content changes
  // from outside. We skip if the change originates from a user commit (we set
  // lastSyncedRef before calling onChange so the next render here is a no-op).
  // We also skip while the user is actively editing — streaming updates pause
  // until they blur.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (content === lastSyncedRef.current) return;
    if (focusedRef.current && !streaming) return;
    el.innerHTML = renderMarkdownToHTML(content);
    lastSyncedRef.current = content;
  }, [content, streaming]);

  // Streaming → dismiss toolbar; editor is not editable.
  useEffect(() => {
    if (streaming) {
      setSelInfo(null);
      setAskMode(false);
    }
  }, [streaming]);

  // Commit user edits: read innerHTML, convert to markdown, push to parent.
  const commit = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const md = htmlToMarkdown(html);
    lastSyncedRef.current = md;
    if (md !== content) onChange(md);
  };

  const handleFocus = () => { focusedRef.current = true; };
  const handleBlur = (e: React.FocusEvent) => {
    // Don't commit / lose focus when blurring into the toolbar (Bold/Italic/Ask)
    if (barRef.current?.contains(e.relatedTarget as Node)) return;
    focusedRef.current = false;
    commit();
  };

  // Dismiss toolbar on outside click.
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

  // Capture selection inside the editor for the floating toolbar.
  useEffect(() => {
    if (!open || streaming) return;

    const capture = (mouseEvent: MouseEvent | null) => {
      if (mouseEvent && barRef.current?.contains(mouseEvent.target as Node)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      const editor = editorRef.current;
      if (!editor) return;
      if (!editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode)) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setSelInfo({
        text,
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
  }, [open, streaming]);

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

  // Apply Bold/Italic via the browser's native execCommand — it wraps the
  // current selection in <strong>/<em>, which turndown converts to **/_ on commit.
  const applyFormat = (cmd: "bold" | "italic") => {
    document.execCommand(cmd);
    setSelInfo(null);
    // Optimistically commit so the markdown source reflects the change even if
    // the user clicks away to a different element.
    commit();
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

        {/* Single contentEditable area. Markdown is rendered as HTML and the
            user edits the rendered output directly. On blur, the HTML is
            converted back to markdown via turndown. */}
        <div className="relative flex-1 overflow-y-auto">
          <div
            ref={editorRef}
            contentEditable={!streaming}
            suppressContentEditableWarning
            onFocus={handleFocus}
            onBlur={handleBlur}
            data-placeholder="Your note will appear here…"
            className={cn(
              "chat-prose text-[15px] outline-none min-h-full note-editor",
              isMobile ? "p-4" : "p-6",
              streaming ? "" : "cursor-text",
            )}
          />
          {streaming && (
            <span
              aria-hidden
              className="absolute bottom-6 left-6 inline-block w-1.5 h-4 align-middle bg-muted-foreground/60 animate-pulse rounded-sm"
            />
          )}
        </div>
      </div>

      <style>{`
        .note-editor:empty::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
      `}</style>

      {selInfo && !streaming && createPortal(
        <div
          ref={barRef}
          onMouseDown={(e) => e.preventDefault()}
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
                onClick={() => applyFormat("bold")}
                className="w-7 h-7 rounded-[6px] hover:bg-dropdown-hover text-foreground flex items-center justify-center font-bold text-[13px] transition-colors"
                aria-label="Bold"
              >
                B
              </button>
              <button
                onClick={() => applyFormat("italic")}
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
