import { Children, cloneElement, isValidElement, memo, useState, type ReactNode } from "react";
import { Brain, Copy, Check, RotateCcw, Trash2, Globe, Search, ExternalLink, ArrowUpRight, Pencil, FileText, Sparkles, Map as MapIcon, ChevronDown, ChevronRight, NotebookPen, Lightbulb, AlertCircle, Scale, Layers, Compass } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import { GoogleServiceLogo, GOOGLE_SERVICE_LABEL, type GoogleService } from "./GoogleServiceLogo";
import { VoyagerLogo, VOYAGER_LABEL } from "./VoyagerLogo";

import { ChartBlock } from "./ChartBlock";

import { MapBlock } from "./MapBlock";
import { PageCard } from "./PageCard";
import type { PageSpec } from "./PageRenderer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Provider } from "@/lib/models";
import type { RequestMeta } from "@/lib/requestMeta";
import { useSmoothText } from "@/hooks/useSmoothText";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { RequestBreakdown } from "./RequestBreakdown";
import { openLightbox } from "./ChatLightbox";

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search" | "map"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";
type Source = { title: string; url: string };
export type ThinkingStep = { index: number; text: string };
export type AgentStep = {
  index: number;
  kind: "search" | "scrape" | "analyze" | "memory" | "plan" | "hypothesis" | "challenge" | "compare" | "synthesize" | "gmail" | "calendar" | "drive" | "voyager" | "read_url";
  label: string;
  intent: string;
  status: ToolStatus;
  foundCount?: number;
  narration: string;
  narrationDone?: boolean;
};
export type MessageAttachmentPreview = { kind: "image" | "file"; name: string; dataUrl?: string };
export type MessageBranch = {
  id: string;
  quotedText: string;
  /** "selection" = branched from a sub-selection of this message; "full" = branched with the Explore button below the message. */
  kind: "selection" | "full";
  /** Number of assistant replies inside this exploration thread. */
  replyCount?: number;
  /** ISO timestamp of the last activity in the exploration thread. */
  lastActivity?: string | null;
  /** First user prompt inside the exploration thread, used as a preview. */
  firstPrompt?: string | null;
};

type Props = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  provider?: Provider;
  model?: string;
  googleService?: GoogleService;
  voyagerService?: boolean;
  memory?: { added: number; updated: number };
  tool?: ToolUse;
  phase?: Phase;
  sources?: Source[];
  meta?: RequestMeta;
  thinking?: ThinkingStep[];
  thinkingMs?: number;
  thinkingDone?: boolean;
  agentSteps?: AgentStep[];
  modelsUsed?: { provider: Provider; model: string }[];
  onRetry?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onExplore?: () => void;
  branches?: MessageBranch[];
  onBranchOpen?: (branchId: string) => void;
  variant?: "default" | "explore";
  attachments?: MessageAttachmentPreview[];
  page?: PageSpec;
  onOpenPage?: () => void;
  hasNote?: boolean;
  onOpenNote?: () => void;
  googleActionSlot?: React.ReactNode;
  reflexion?: boolean;
};

function MemoryBadge({ added, updated }: { added: number; updated: number }) {
  const total = added + updated;
  if (total <= 0) return null;
  const label =
    added > 0 && updated > 0
      ? `Memory updated (${added} added, ${updated} edited)`
      : added > 0
        ? `Added to memory${added > 1 ? ` (${added})` : ""}`
        : `Memory updated${updated > 1 ? ` (${updated})` : ""}`;
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Brain className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}

function ActionButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors px-[5px] py-[5px]"
    >
      {children}
    </button>
  );
}

function ToolBadge({ tool, label }: ToolUse) {
  const Icon = tool === "scrape" ? Globe : tool === "map" ? MapIcon : Search;
  const text = tool === "scrape" ? "Read page" : tool === "map" ? "Map" : "Web search";
  // Truncate long URLs/queries
  const shortLabel = label.length > 60 ? label.slice(0, 57) + "…" : label;
  return (
    <div className="inline-flex items-center h-6 gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground max-w-full">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate text-base">{label ? `${text}: ${shortLabel}` : text}</span>
    </div>
  );
}

/**
 * Renders the AI's "thinking" preamble (Claude-style).
 * - While streaming: each step appears in italic muted text, fading in one by one.
 * - Once the main answer has started AND thinking is done: collapses into
 *   "✦ Thought for Xs" pill that the user can click to re-expand.
 */
function ThinkingTrace({
  steps,
  durationMs,
  done,
  hasAnswer,
}: {
  steps: ThinkingStep[];
  durationMs?: number;
  done?: boolean;
  hasAnswer: boolean;
}) {
  const shouldCollapse = !!done && hasAnswer;
  const [open, setOpen] = useState(!shouldCollapse);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  if (shouldCollapse && !autoCollapsed) {
    setAutoCollapsed(true);
    queueMicrotask(() => setOpen(false));
  }
  if (!steps || steps.length === 0) return null;

  const seconds = durationMs && durationMs > 0 ? Math.max(1, Math.round(durationMs / 1000)) : null;
  const headerLabel = done
    ? seconds != null ? `Thought for ${seconds}s` : "Thought"
    : "Thinking";

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Sparkles className="w-3.5 h-3.5" />
        <span className={done ? "" : "text-shimmer"}>{headerLabel}</span>
      </button>
      {open && (
        <ul className="mt-2 ml-1 border-l-2 border-border pl-3 flex flex-col gap-1.5">
          {steps.map((s) => (
            <li
              key={s.index}
              className="text-[15px] text-foreground leading-snug animate-in fade-in slide-in-from-left-1 duration-300"
            >
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function getStatusMessage(phase: Phase | undefined, tool: ToolUse | undefined, provider?: string, googleService?: GoogleService): string {
  if (provider === "page") return "Crafting your page…";
  if (googleService) return `Searching in ${GOOGLE_SERVICE_LABEL[googleService]}…`;
  if (tool) {
    const short = tool.label.length > 50 ? tool.label.slice(0, 47) + "…" : tool.label;
    if (tool.status === "done") {
      if (tool.tool === "scrape") return "Summarizing page…";
      if (tool.tool === "map") return "Drawing map…";
      return "Summarizing results…";
    }
    if (tool.status === "failed") {
      return "Tool unavailable, continuing without it…";
    }
    // running
    if (tool.tool === "scrape") return `Reading ${short}…`;
    if (tool.tool === "map") return short ? `Mapping: ${short}…` : "Preparing map…";
    return `Searching: "${short}"…`;
  }
  if (phase === "analyzing") return "Analyzing your request…";
  if (phase === "generating") return "Thinking…";
  return "Thinking…";
}

function faviconUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=64&domain=${u.hostname}`;
  } catch {
    return null;
  }
}

function SourceTag({ indices, sources }: { indices: number[]; sources: Source[] }) {
  const items = indices
    .map((n) => ({ n, src: sources[n - 1] }))
    .filter((x) => x.src);
  if (!items.length) return null;
  const thumbs = items.slice(0, 3);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center align-middle mx-0.5 h-5 pl-0.5 pr-1.5 rounded-full text-[10px] font-medium transition-colors no-underline gap-1"
          style={{ background: "#F8F7F5", color: "#888888" }}
        >
          <span className="inline-flex items-center">
            {thumbs.map(({ n, src }, i) => {
              const fav = faviconUrl(src.url);
              return (
                <span
                  key={n}
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted overflow-hidden ${i > 0 ? "-ml-1.5" : ""}`}
                  style={{ zIndex: thumbs.length - i, boxShadow: "0 0 0 1.5px #F8F7F5" }}
                >
                  {fav ? (
                    <img
                      src={fav}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : null}
                </span>
              );
            })}
          </span>
          <span>Source</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="text-[11px] font-medium text-muted-foreground px-2 py-1">
          {items.length === 1 ? "Source" : `${items.length} sources`}
        </div>
        <ul className="flex flex-col">
          {items.map(({ n, src }) => {
            let host = "";
            try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch { host = src.url; }
            const fav = faviconUrl(src.url);
            return (
              <li key={n}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-dropdown-hover no-underline"
                >
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                    {fav ? (
                      <img src={fav} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">{n}</span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-foreground line-clamp-2 leading-snug">
                      {src.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate text-base">{host}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// Match a citation marker with several common variants the LLM may emit:
//   [source:1]            [source: 1, 2]        [sources:1,2]
//   (source:1)            (sources: 1, 2)
//   【source:1】           〔source:1〕
// Always case-insensitive, allowing optional whitespace.
const SOURCE_RE = /\s*[\[\(\u3010\u3014]\s*sources?\s*[:\uFF1A]\s*([\d,\s]+?)\s*[\]\)\u3011\u3015]/gi;

// Strip inline [source:N] markers from text and collect all referenced indices.
function collectAndStripSources(
  text: string,
  sources: Source[],
): { text: string; indices: number[] } {
  const found = new Set<number>();
  SOURCE_RE.lastIndex = 0;
  const stripped = text.replace(SOURCE_RE, (_m, g1: string) => {
    g1.split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= sources.length)
      .forEach((n) => found.add(n));
    return "";
  });
  return { text: stripped, indices: Array.from(found).sort((a, b) => a - b) };
}

function buildMdComponents(sources: Source[] | undefined, isAssistant: boolean) {
  // Recursively strip [source:N] markers from any text nodes, while
  // collecting all referenced source indices into `collected`.
  const stripChildren = (children: ReactNode, collected: Set<number>): ReactNode => {
    if (!sources?.length) return children;

    if (typeof children === "string") {
      const { text, indices } = collectAndStripSources(children, sources);
      indices.forEach((n) => collected.add(n));
      return text;
    }

    if (Array.isArray(children)) {
      return children.map((child, index) => {
        if (typeof child === "string") {
          const { text, indices } = collectAndStripSources(child, sources);
          indices.forEach((n) => collected.add(n));
          return text;
        }
        if (isValidElement(child)) {
          return cloneElement(child as React.ReactElement<any>, {
            key: child.key ?? index,
            children: stripChildren((child.props as { children?: ReactNode }).children, collected),
          });
        }
        return child;
      });
    }

    if (isValidElement(children)) {
      return cloneElement(children as React.ReactElement<any>, {
        children: stripChildren((children.props as { children?: ReactNode }).children, collected),
      });
    }

    return children;
  };

  // Wrap a block-level element: strip inline [source:N] markers (sources are shown once at the end).
  const renderBlock = (Tag: keyof JSX.IntrinsicElements, children: ReactNode, props: any) => {
    if (!sources?.length) {
      return <Tag {...props}>{children}</Tag>;
    }
    const collected = new Set<number>();
    const stripped = stripChildren(children, collected);
    return <Tag {...props}>{stripped}</Tag>;
  };

  return {
    a: ({ node, children, ...props }: any) => (
      <a {...props} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-0.5">
        <span>{children}</span>
        {isAssistant && (
          <ArrowUpRight className="w-3.5 h-3.5 shrink-0 self-center -translate-y-[1px] opacity-70" aria-hidden />
        )}
      </a>
    ),
    // Images are extracted and rendered separately above the text — never inline.
    img: () => null,
    p: ({ node, children, ...props }: any) => {
      // If a paragraph would only contain images (now stripped), drop it entirely.
      const astChildren: any[] = Array.isArray(node?.children) ? node.children : [];
      const meaningful = astChildren.filter(
        (c) => !(c.type === "text" && (!c.value || /^\s*$/.test(c.value))),
      );
      if (meaningful.length > 0 && meaningful.every((c) => c.type === "image")) {
        return null;
      }
      return renderBlock("p", children, props);
    },
    li: ({ node, children, ...props }: any) => renderBlock("li", children, props),
    blockquote: ({ node, children, ...props }: any) => renderBlock("blockquote", children, props),
    td: ({ node, children, ...props }: any) => renderBlock("td" as any, children, props),
    th: ({ node, children, ...props }: any) => renderBlock("th" as any, children, props),
    table: ({ node, children, ...props }: any) => (
      <div className="table-wrapper">
        <table {...props}>{children}</table>
      </div>
    ),
    h1: ({ node, children, ...props }: any) => renderBlock("h1" as any, children, props),
    h2: ({ node, children, ...props }: any) => renderBlock("h2" as any, children, props),
    h3: ({ node, children, ...props }: any) => renderBlock("h3" as any, children, props),
    h4: ({ node, children, ...props }: any) => renderBlock("h4" as any, children, props),
    h5: ({ node, children, ...props }: any) => renderBlock("h5" as any, children, props),
    h6: ({ node, children, ...props }: any) => renderBlock("h6" as any, children, props),
    pre: ({ node, children, ...props }: any) => {
      // Unwrap <pre> styling for special blocks (chart/graph/map) so they render edge-to-edge without the muted background.
      const astChildren: any[] = Array.isArray(node?.children) ? node.children : [];
      const codeNode = astChildren.find((c) => c.tagName === "code");
      const lang = codeNode?.properties?.className?.find?.((cn: string) => cn?.startsWith?.("language-"))?.replace("language-", "");
      const SPECIAL = new Set(["chart", "graph", "map"]);
      if (lang && SPECIAL.has(lang)) {
        return <>{children}</>;
      }
      return <pre {...props}>{children}</pre>;
    },
    code: ({ node, inline, className, children, ...props }: any) => {
      const lang = /language-(\w+)/.exec(className || "")?.[1];
      const raw = String(children ?? "").replace(/\n$/, "");
      if (!inline && lang === "map") {
        return <MapBlock code={raw} />;
      }
      if (!inline && (lang === "chart" || lang === "graph")) {
        return <ChartBlock code={raw} />;
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Match markdown images: ![alt](url). We extract them out so they render in a dedicated strip.
const MD_IMG_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;

function extractImages(content: string): { images: { src: string; alt: string }[]; text: string } {
  const images: { src: string; alt: string }[] = [];
  const seen = new Set<string>();
  // Unwrap linked images [![alt](src)](href) → ![alt](src)
  let text = content.replace(/\[(!\[[^\]]*\]\([^)]+\))\]\([^)]+\)/g, "$1");
  text = text.replace(MD_IMG_RE, (_m, alt: string, src: string) => {
    if (!seen.has(src)) {
      seen.add(src);
      images.push({ src, alt: alt || "" });
    }
    return "";
  });
  // Tidy leftover whitespace from removed images
  text = text.replace(/^[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { images, text };
}

function ImageStrip({ images }: { images: { src: string; alt: string }[] }) {
  if (!images.length) return null;
  return (
    <div className="mb-4 -mx-1 overflow-x-auto overflow-y-hidden">
      <div className="flex flex-nowrap gap-2 px-1 pb-1 items-center">
        {images.map((img, i) => (
          <button
            key={`${img.src}-${i}`}
            type="button"
            onClick={() => openLightbox(img.src, img.alt)}
            aria-label={img.alt ? `Open image: ${img.alt}` : "Open image"}
            className="group relative shrink-0 rounded-xl overflow-hidden border border-border bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <img
              src={img.src}
              alt={img.alt}
              loading="lazy"
              className="block h-48 w-auto max-w-none object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              onError={(e) => {
                const btn = e.currentTarget.parentElement as HTMLButtonElement | null;
                if (btn) btn.style.display = "none";
              }}
            />
            {img.alt ? (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 py-1.5 text-[11px] text-white bg-gradient-to-t from-black/70 to-transparent text-left line-clamp-2">
                {img.alt}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThreadEntry({ branch, onClick }: { branch: MessageBranch; onClick: () => void }) {
  const promptText = (branch.firstPrompt ?? "")
    .replace(/^\/(note|explore)(\s+|$)/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback =
    branch.kind === "selection"
      ? branch.quotedText.replace(/\s+/g, " ").trim()
      : "Exploration de cette réponse";
  const raw = promptText || fallback;
  const preview = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  const count = branch.replyCount ?? 0;
  const replyLabel =
    count === 0
      ? "Ouvrir l'exploration"
      : `${count} ${count === 1 ? "exploration" : "explorations"}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left hover:bg-dropdown-hover transition-colors"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground/70">
        <Sparkles className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 flex-1 flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-foreground whitespace-nowrap">
          {replyLabel}
        </span>
        <span className="text-[12px] text-muted-foreground truncate text-base italic">
          {preview}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        View thread
      </span>
    </button>
  );
}

function WebSearchIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path d="M8.00004 14.6666C11.6819 14.6666 14.6667 11.6819 14.6667 7.99998C14.6667 4.31808 11.6819 1.33331 8.00004 1.33331C4.31814 1.33331 1.33337 4.31808 1.33337 7.99998C1.33337 11.6819 4.31814 14.6666 8.00004 14.6666Z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.33337 7.99998C5.33337 12 8.00004 14.6666 8.00004 14.6666C8.00004 14.6666 10.6667 12 10.6667 7.99998C10.6667 3.99998 8.00004 1.33331 8.00004 1.33331C8.00004 1.33331 5.33337 3.99998 5.33337 7.99998Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M14 10H2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 6H2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ReflexionStepIcon({ kind, running }: { kind: AgentStep["kind"]; running: boolean }) {
  const cls = `w-3.5 h-3.5 shrink-0 ${running ? "animate-pulse" : ""}`;
  if (kind === "search") return <WebSearchIcon className={running ? "animate-pulse shrink-0" : "shrink-0"} />;
  if (kind === "scrape" || kind === "read_url") return <Globe className={cls} />;
  if (kind === "memory") return <Brain className={cls} />;
  if (kind === "gmail") return <GoogleServiceLogo service="gmail" className={cls} />;
  if (kind === "calendar") return <GoogleServiceLogo service="calendar" className={cls} />;
  if (kind === "drive") return <GoogleServiceLogo service="drive" className={cls} />;
  if (kind === "voyager") return <VoyagerLogo className={cls} />;
  if (kind === "plan") return <Compass className={cls} />;
  if (kind === "hypothesis") return <Lightbulb className={cls} />;
  if (kind === "challenge") return <AlertCircle className={cls} />;
  if (kind === "compare") return <Scale className={cls} />;
  if (kind === "synthesize") return <Layers className={cls} />;
  return <Sparkles className={cls} />;
}

function reflexionStepTag(kind: AgentStep["kind"]): string {
  switch (kind) {
    case "search": return "Web Search";
    case "scrape":
    case "read_url": return "Read";
    case "memory": return "Memory";
    case "gmail": return "Gmail";
    case "calendar": return "Calendar";
    case "drive": return "Drive";
    case "voyager": return "Voyager";
    case "plan": return "Plan";
    case "hypothesis": return "Hypothesis";
    case "challenge": return "Challenge";
    case "compare": return "Compare";
    case "synthesize": return "Synthesize";
    case "analyze":
    default: return "Analyze";
  }
}

function StepSourcesInline({ count, sources }: { count: number; sources?: Source[] }) {
  if (count <= 0) return null;
  const items = (sources ?? []).slice(0, count);
  const thumbs = items.slice(0, 3);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 pl-0.5 pr-2 h-5 rounded-full text-[10px] font-medium transition-colors shrink-0"
          style={{ background: "#F8F7F5", color: "#888888" }}
        >
          <span className="inline-flex items-center">
            {thumbs.map((src, i) => {
              const fav = faviconUrl(src.url);
              return (
                <span
                  key={i}
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted overflow-hidden ${i > 0 ? "-ml-1.5" : ""}`}
                  style={{ zIndex: thumbs.length - i, boxShadow: "0 0 0 1.5px #F8F7F5" }}
                >
                  {fav ? (
                    <img
                      src={fav}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : null}
                </span>
              );
            })}
          </span>
          <span className="whitespace-nowrap">{count === 1 ? "Source" : `${count} Sources`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <div className="text-[11px] font-medium text-muted-foreground px-2 py-1">
          {items.length === 1 ? "Source" : `${items.length} Sources`}
        </div>
        <ul className="flex flex-col">
          {items.map((src, n) => {
            let host = "";
            try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch { host = src.url; }
            const fav = faviconUrl(src.url);
            return (
              <li key={n}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-dropdown-hover no-underline"
                >
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                    {fav ? (
                      <img src={fav} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-[10px] font-medium text-muted-foreground">{n + 1}</span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-foreground line-clamp-2 leading-snug">{src.title}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">{host}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-1" />
                </a>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function AgentStepCard({ step, sources }: { step: AgentStep; sources?: Source[] }) {
  const isRunning = step.status === "running";
  const isFailed = step.status === "failed";
  const tag = reflexionStepTag(step.kind);
  const subject = step.label || step.intent;
  const shortSubject = subject.length > 80 ? subject.slice(0, 77) + "…" : subject;
  return (
    <div className="mb-3">
      {/* Flat row: no background, no pill. Icon + label in #888, separator, detail in #B7B7B7 */}
      <div className="flex items-center gap-1.5 text-[12px] font-medium min-w-0" style={{ color: "#888888" }}>
        <ReflexionStepIcon kind={step.kind} running={isRunning} />
        <span className="shrink-0">{tag}</span>
        {subject && (
          <>
            <span className="shrink-0" style={{ color: "#CCCCCC" }}>·</span>
            <span className="truncate font-normal" style={{ color: "#B7B7B7" }} title={subject}>{shortSubject}</span>
          </>
        )}
        {step.kind === "search" && step.status === "done" && step.foundCount !== undefined && step.foundCount > 0 && (
          <StepSourcesInline count={step.foundCount} sources={sources} />
        )}
        {isFailed && <span className="text-destructive text-[11px] ml-1 shrink-0">failed</span>}
      </div>
      {/* Narration in default foreground color */}
      {step.narration && (
        <p className="mt-1.5 text-[15px] text-foreground leading-relaxed whitespace-pre-wrap">
          {step.narration}
          {!step.narrationDone && (
            <span className="inline-block w-1 h-3 ml-0.5 bg-muted-foreground/60 animate-pulse align-middle" />
          )}
        </p>
      )}
    </div>
  );
}

function AgentStepsTrace({ steps, sources }: { steps: AgentStep[]; sources?: Source[] }) {
  if (!steps.length) return null;
  const sorted = [...steps].sort((a, b) => a.index - b.index);
  return (
    <div className="mb-3">
      {sorted.map((s) => <AgentStepCard key={s.index} step={s} sources={sources} />)}
    </div>
  );
}

function ChatMessageImpl({
  id,
  role,
  content,
  streaming,
  provider,
  model,
  googleService,
  voyagerService,
  memory,
  tool,
  phase,
  sources,
  meta,
  thinking,
  thinkingMs,
  thinkingDone,
  agentSteps,
  modelsUsed,
  reflexion,
  onRetry,
  onDelete,
  onEdit,
  onExplore,
  branches,
  onBranchOpen,
  variant,
  attachments,
  page,
  onOpenPage,
  hasNote,
  onOpenNote,
  googleActionSlot,
}: Props) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  const [devMode] = useDeveloperMode();
  // Smooth typewriter for assistant messages while streaming.
  const smoothed = useSmoothText(content, !isUser && !!streaming);
  const display = isUser ? content : (streaming ? smoothed : content);
  const mdComponents = buildMdComponents(sources, !isUser);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (isUser) {
    const modeMatch = content.match(/^\/(note|page|explore)(\s+|$)/);
    const modeId = modeMatch ? (modeMatch[1] as "note" | "page" | "explore") : null;
    const rest = modeMatch ? content.slice(modeMatch[0].length) : content;

    // Build all active mode tags — grey pill, no border, icon + label same colour
    const modePillClass = "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground";
    const modeTags: React.ReactNode[] = [];
    if (modeId === "note") {
      modeTags.push(
        <div key="note" className={modePillClass}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 shrink-0">
            <path d="M7.66663 3.33331C9.55223 3.33331 10.495 3.33331 11.0808 3.9191C11.6666 4.50489 11.6666 5.44769 11.6666 7.33331C11.6666 12.6666 14.3333 12.6666 14.3333 12.6666H4.82571C4.60707 12.6666 4.49775 12.6666 4.24986 12.6021C4.00197 12.5375 3.96254 12.5155 3.88368 12.4714C3.12363 12.0468 1.66663 10.7828 1.66663 7.33331C1.66663 5.44769 1.66663 4.50489 2.25241 3.9191C2.8382 3.33331 3.78101 3.33331 5.66663 3.33331" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1.66663 6.66669V10.6667C1.66663 12.5523 1.66663 13.4951 2.25241 14.0809C2.8382 14.6667 3.78101 14.6667 5.66663 14.6667H7.71736C9.60296 14.6667 10.5458 14.6667 11.1316 14.0809C11.4582 13.7543 11.6027 13.3168 11.6666 12.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7.66663 2.33331V4.33331C7.66663 4.64394 7.66663 4.79925 7.61589 4.92177C7.54823 5.08512 7.41843 5.21491 7.25509 5.28257C7.13256 5.33331 6.97723 5.33331 6.66663 5.33331C6.356 5.33331 6.20069 5.33331 6.07817 5.28257C5.91482 5.21491 5.78503 5.08512 5.71737 4.92177C5.66663 4.79925 5.66663 4.64394 5.66663 4.33331V2.33331C5.66663 2.02269 5.66663 1.86737 5.71737 1.74486C5.78503 1.58151 5.91482 1.45172 6.07817 1.38406C6.20069 1.33331 6.356 1.33331 6.66663 1.33331C6.97723 1.33331 7.13256 1.33331 7.25509 1.38406C7.41843 1.45172 7.54823 1.58151 7.61589 1.74486C7.66663 1.86737 7.66663 2.02269 7.66663 2.33331Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Note</span>
        </div>
      );
    }
    if (modeId === "page") {
      modeTags.push(
        <div key="page" className={modePillClass}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 shrink-0">
            <path d="M2 8C2 5.17157 2 3.75736 2.87868 2.87868C3.75736 2 5.17157 2 8 2C10.8284 2 12.2427 2 13.1213 2.87868C14 3.75736 14 5.17157 14 8C14 10.8284 14 12.2427 13.1213 13.1213C12.2427 14 10.8284 14 8 14C5.17157 14 3.75736 14 2.87868 13.1213C2 12.2427 2 10.8284 2 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2.33337 5.33331H13.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8.66663 8H11.3333" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8.66663 10.6667H9.99996" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 5.33331V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Page</span>
        </div>
      );
    }
    if (modeId === "explore") {
      modeTags.push(
        <div key="explore" className={modePillClass}>
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>Explore</span>
        </div>
      );
    }
    if (reflexion) {
      modeTags.push(
        <div key="reflexion" className={modePillClass}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 shrink-0">
            <path d="M8 2C5.79 2 4 3.79 4 6c0 1.27.59 2.4 1.5 3.13V11c0 .55.45 1 1 1h3c.55 0 1-.45 1-1V9.13C11.41 8.4 12 7.27 12 6c0-2.21-1.79-4-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6.5 13.5h3M7 14.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Reflexion</span>
        </div>
      );
    }
    if (googleService) {
      modeTags.push(
        <div key="google" className={modePillClass}>
          <GoogleServiceLogo service={googleService} className="w-3.5 h-3.5 shrink-0" />
          <span>{GOOGLE_SERVICE_LABEL[googleService]}</span>
        </div>
      );
    }
    if (voyagerService) {
      modeTags.push(
        <div key="voyager" className={modePillClass}>
          <VoyagerLogo className="w-3.5 h-3.5 shrink-0" />
          <span>{VOYAGER_LABEL}</span>
        </div>
      );
    }

    return (
      <div className="w-full py-3" id={id ? `chat-anchor-${id}` : undefined}>
        <div className="max-w-3xl mx-auto px-4 flex flex-col items-end gap-1.5">
          {modeTags.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">{modeTags}</div>
          )}
          {attachments && attachments.length > 0 && (
            <div className="max-w-[80%] flex flex-wrap gap-2 justify-end">
              {attachments.map((a, i) =>
                a.kind === "image" && a.dataUrl ? (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.name}
                    className="w-20 h-20 rounded-lg object-cover border border-border"
                  />
                ) : (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
                  >
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="max-w-[160px] truncate text-base">{a.name}</span>
                  </div>
                ),
              )}
            </div>
          )}
          {(rest || !attachments || attachments.length === 0) && (
            <div className={`max-w-[80%] rounded-2xl ${variant === "explore" ? "bg-background" : "bg-bubble-user"} text-bubble-user-foreground px-6 md:px-4 py-2.5 chat-prose break-words`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{rest || " "}</ReactMarkdown>
            </div>
          )}
          {memory && <MemoryBadge added={memory.added} updated={memory.updated} />}
          {(onEdit || content) && (
            <div className="flex items-center gap-1 -mr-1.5">
              {onEdit && (
                <ActionButton onClick={onEdit} ariaLabel="Edit">
                  <Pencil className="w-4 h-4" />
                </ActionButton>
              )}
              <ActionButton onClick={handleCopy} ariaLabel={copied ? "Copied" : "Copy"}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </ActionButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  const allBranches = branches ?? [];

  return (
    <div className="relative w-full my-[50px]" data-assistant-message="true" data-message-id={id ?? ""}>
      <div className="max-w-3xl mx-auto px-6 md:px-4">
        {(provider || googleService || voyagerService || (tool && tool.status !== "failed")) && (
          <div className="mb-1.5 flex items-center flex-wrap" style={{ gap: "10px" }}>
            {provider && <ProviderBadge provider={provider} model={model} modelsUsed={modelsUsed} />}
            {googleService && (
              <div
                className="inline-flex items-center h-6 gap-1.5 rounded-full bg-[var(--blue-tag-bg)] px-2.5 text-[11px] font-medium max-w-full"
                style={{ color: "var(--blue-tag-fg)" }}
              >
                <GoogleServiceLogo service={googleService} className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-base">{GOOGLE_SERVICE_LABEL[googleService]}</span>
              </div>
            )}
            {voyagerService && (
              <div
                className="inline-flex items-center h-6 gap-1.5 rounded-full bg-[var(--blue-tag-bg)] px-2.5 text-[11px] font-medium max-w-full"
                style={{ color: "var(--blue-tag-fg)" }}
              >
                <VoyagerLogo className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-base">{VOYAGER_LABEL}</span>
              </div>
            )}
            {tool && tool.status !== "failed" && <ToolBadge tool={tool.tool} label={tool.label} />}
          </div>
        )}
        {thinking && thinking.length > 0 && (
          <ThinkingTrace
            steps={thinking}
            durationMs={thinkingMs}
            done={thinkingDone}
            hasAnswer={!!display}
          />
        )}
        {agentSteps && agentSteps.length > 0 && <AgentStepsTrace steps={agentSteps} sources={sources} />}
        {(() => {
          const { images, text } = display ? extractImages(display) : { images: [], text: "" };
          const hasThinking = !!(thinking && thinking.length > 0);
          return (
            <>
              {images.length > 0 && <ImageStrip images={images} />}
              <div className="chat-prose break-words">
                {display ? (
                  text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
                  ) : null
                ) : streaming && !hasThinking ? (
                  <span className="inline-flex items-center gap-1.5 text-shimmer text-base font-medium">
                    {googleService && (
                      <GoogleServiceLogo service={googleService} className="w-4 h-4 shrink-0" />
                    )}
                    <span>{getStatusMessage(phase, tool, provider, googleService)}</span>
                  </span>
                ) : " "}
              </div>
              {!isUser && !streaming && sources && sources.length > 0 && (
                <div className="mt-2">
                  <SourceTag indices={sources.map((_, i) => i + 1)} sources={sources} />
                </div>
              )}
            </>
          );
        })()}
        {page && onOpenPage && <PageCard page={page} onOpen={onOpenPage} />}
        {googleActionSlot}
        {!streaming && content && (
          <div className="relative mt-2 flex items-center gap-1 -ml-1.5">
            <ActionButton onClick={handleCopy} ariaLabel={copied ? "Copied" : "Copy"}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </ActionButton>
            {onRetry && (
              <ActionButton onClick={onRetry} ariaLabel="Retry">
                <RotateCcw className="w-4 h-4" />
              </ActionButton>
            )}
            {onDelete && (
              <ActionButton onClick={onDelete} ariaLabel="Delete">
                <Trash2 className="w-4 h-4" />
              </ActionButton>
            )}
            {onExplore && (
              <button
                type="button"
                onClick={onExplore}
                aria-label="Explore"
                className="ml-1 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-card text-[11px] font-medium text-foreground text-sm hover:text-foreground hover:bg-dropdown-hover transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Explore
              </button>
            )}
            {hasNote && onOpenNote && (
              <button
                type="button"
                onClick={onOpenNote}
                aria-label="Open note"
                className="ml-1 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-border bg-card text-[11px] font-medium text-foreground text-sm hover:text-foreground hover:bg-dropdown-hover transition-colors"
              >
                <NotebookPen className="w-3.5 h-3.5" />
                Open Note
              </button>
            )}
            {devMode && meta && <RequestBreakdown meta={meta} />}
          </div>
        )}
        {/* Slack-thread style explorations list, shown under the assistant response */}
        {!streaming && allBranches.length > 0 && (
          <div className="mt-3 border-l-2 border-border pl-3 flex flex-col gap-0.5">
            {allBranches.map((b) => (
              <ThreadEntry
                key={b.id}
                branch={b}
                onClick={() => onBranchOpen?.(b.id)}
              />
            ))}
          </div>
        )}
        
      </div>
    </div>
  );
}

// Memoize so historical messages don't re-render on every streaming tick.
export const ChatMessage = memo(ChatMessageImpl, (prev, next) =>
  prev.id === next.id &&
  prev.role === next.role &&
  prev.content === next.content &&
  prev.streaming === next.streaming &&
  prev.provider === next.provider &&
  prev.model === next.model &&
  prev.googleService === next.googleService &&
  prev.memory?.added === next.memory?.added &&
  prev.memory?.updated === next.memory?.updated &&
  prev.tool?.tool === next.tool?.tool &&
  prev.tool?.label === next.tool?.label &&
  prev.tool?.status === next.tool?.status &&
  prev.phase === next.phase &&
  prev.sources === next.sources &&
  prev.meta === next.meta &&
  prev.onRetry === next.onRetry &&
  prev.onDelete === next.onDelete &&
  prev.onEdit === next.onEdit &&
  prev.onExplore === next.onExplore &&
  prev.branches === next.branches &&
  prev.onBranchOpen === next.onBranchOpen &&
  prev.variant === next.variant &&
  prev.attachments === next.attachments &&
  prev.page === next.page &&
  prev.onOpenPage === next.onOpenPage &&
  prev.hasNote === next.hasNote &&
  prev.onOpenNote === next.onOpenNote &&
  prev.googleActionSlot === next.googleActionSlot &&
  prev.thinking === next.thinking &&
  prev.thinkingMs === next.thinkingMs &&
  prev.thinkingDone === next.thinkingDone &&
  prev.reflexion === next.reflexion &&
  prev.voyagerService === next.voyagerService,
);
