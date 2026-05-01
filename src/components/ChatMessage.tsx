import { Children, cloneElement, isValidElement, memo, useState, type ReactNode } from "react";
import { Brain, Copy, Check, RotateCcw, Trash2, Globe, Search, ExternalLink, ArrowUpRight, Pencil, FileText, Sparkles, Map as MapIcon, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import { GoogleServiceLogo, GOOGLE_SERVICE_LABEL, type GoogleService } from "./GoogleServiceLogo";
import { FlowDiagram } from "./FlowDiagram";
import { ChartBlock } from "./ChartBlock";

import { CanvasBlock } from "./CanvasBlock";
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
  kind: "search" | "scrape" | "analyze";
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
  memory?: { added: number; updated: number };
  tool?: ToolUse;
  phase?: Phase;
  sources?: Source[];
  meta?: RequestMeta;
  thinking?: ThinkingStep[];
  thinkingMs?: number;
  thinkingDone?: boolean;
  agentSteps?: AgentStep[];
  canvas?: string;
  canvasTitle?: string;
  canvasVersion?: number;
  canvasCollapsed?: boolean;
  onCanvasChange?: (next: string) => void;
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
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
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
    <div className="inline-flex items-center h-6 gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground max-w-full">
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
              className="text-[13px] italic text-muted-foreground leading-snug animate-in fade-in slide-in-from-left-1 duration-300"
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
          className="inline-flex items-center align-middle mx-0.5 h-5 pl-0.5 pr-1.5 rounded-full border border-border bg-card text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors no-underline gap-1"
        >
          <span className="inline-flex items-center">
            {thumbs.map(({ n, src }, i) => {
              const fav = faviconUrl(src.url);
              return (
                <span
                  key={n}
                  className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted overflow-hidden ring-1 ring-card ${i > 0 ? "-ml-1.5" : ""}`}
                  style={{ zIndex: thumbs.length - i }}
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

  // Wrap a block-level element: strip inline markers and append one grouped tag at the end.
  const renderBlock = (Tag: keyof JSX.IntrinsicElements, children: ReactNode, props: any) => {
    if (!sources?.length) {
      return <Tag {...props}>{children}</Tag>;
    }
    const collected = new Set<number>();
    const stripped = stripChildren(children, collected);
    const indices = Array.from(collected).sort((a, b) => a - b);
    return (
      <Tag {...props}>
        {stripped}
        {indices.length > 0 && (
          <>
            {" "}
            <SourceTag indices={indices} sources={sources} />
          </>
        )}
      </Tag>
    );
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
      // Unwrap <pre> styling for special blocks (chart/graph/map/flow/diagram) so they render edge-to-edge without the muted background.
      const astChildren: any[] = Array.isArray(node?.children) ? node.children : [];
      const codeNode = astChildren.find((c) => c.tagName === "code");
      const lang = codeNode?.properties?.className?.find?.((cn: string) => cn?.startsWith?.("language-"))?.replace("language-", "");
      const SPECIAL = new Set(["chart", "graph", "map", "flow", "reactflow", "diagram"]);
      if (lang && SPECIAL.has(lang)) {
        return <>{children}</>;
      }
      return <pre {...props}>{children}</pre>;
    },
    code: ({ node, inline, className, children, ...props }: any) => {
      const lang = /language-(\w+)/.exec(className || "")?.[1];
      const raw = String(children ?? "").replace(/\n$/, "");
      if (!inline && (lang === "flow" || lang === "reactflow" || lang === "diagram")) {
        return <FlowDiagram code={raw} />;
      }
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

function AgentStepCard({ step }: { step: AgentStep }) {
  const Icon = step.kind === "search" ? Search : step.kind === "scrape" ? Globe : Sparkles;
  const tag = step.kind === "search" ? "Web search" : step.kind === "scrape" ? "Read page" : "Analyze";
  const isRunning = step.status === "running";
  const isFailed = step.status === "failed";
  // Tag = subject of the step (search query, URL, or analyze intent)
  const subject = step.label || step.intent;
  const shortSubject = subject.length > 80 ? subject.slice(0, 77) + "…" : subject;
  return (
    <div className="mb-4">
      {/* Tag aligned left: icon + type + subject inline */}
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground max-w-full">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "animate-pulse" : ""}`} />
        <span className="text-muted-foreground shrink-0">{tag}</span>
        {subject && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate text-base" title={subject}>{shortSubject}</span>
          </>
        )}
        {step.status === "done" && step.foundCount !== undefined && step.foundCount > 0 && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground whitespace-nowrap shrink-0">
              {step.foundCount} source{step.foundCount > 1 ? "s" : ""}
            </span>
          </>
        )}
        {isFailed && <span className="text-destructive ml-1">failed</span>}
      </div>
      {/* Narration as plain text below, no box */}
      {step.narration && (
        <p className="mt-2 text-sm text-muted-foreground italic leading-relaxed whitespace-pre-wrap">
          {step.narration}
          {!step.narrationDone && (
            <span className="inline-block w-1 h-3 ml-0.5 bg-muted-foreground/60 animate-pulse align-middle" />
          )}
        </p>
      )}
    </div>
  );
}

function AgentStepsTrace({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  const sorted = [...steps].sort((a, b) => a.index - b.index);
  return (
    <div className="mb-3">
      {sorted.map((s) => <AgentStepCard key={s.index} step={s} />)}
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
  memory,
  tool,
  phase,
  sources,
  meta,
  thinking,
  thinkingMs,
  thinkingDone,
  agentSteps,
  canvas,
  canvasTitle,
  canvasVersion,
  canvasCollapsed,
  onCanvasChange,
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
    const ModeTag = modeId ? (() => {
      const cfg = {
        note: { label: "Note", Icon: Pencil },
        page: { label: "Page", Icon: FileText },
        explore: { label: "Explore", Icon: Sparkles },
      }[modeId];
      const Icon = cfg.Icon;
      return (
        <div className="inline-flex items-center h-6 gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground">
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span>{cfg.label}</span>
        </div>
      );
    })() : null;
    return (
      <div className="w-full py-3" id={id ? `chat-anchor-${id}` : undefined}>
        <div className="max-w-3xl mx-auto px-4 flex flex-col items-end gap-1.5">
          {ModeTag}
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
            <div className={`max-w-[80%] rounded-2xl ${variant === "explore" ? "bg-background" : "bg-bubble-user"} text-bubble-user-foreground px-4 py-2.5 chat-prose break-words`}>
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
      <div className="max-w-3xl mx-auto px-4">
        {(provider || googleService || (tool && tool.status !== "failed")) && (
          <div className="mb-1.5 flex items-center flex-wrap" style={{ gap: "10px" }}>
            {provider && <ProviderBadge provider={provider} model={model} />}
            {googleService && (
              <div
                className="inline-flex items-center h-6 gap-1.5 rounded-full bg-[#E6F1FF] px-2.5 text-[11px] font-medium max-w-full"
                style={{ color: "#0062FF" }}
              >
                <GoogleServiceLogo service={googleService} className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate text-base">{GOOGLE_SERVICE_LABEL[googleService]}</span>
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
        {agentSteps && agentSteps.length > 0 && <AgentStepsTrace steps={agentSteps} />}
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
            </>
          );
        })()}
        {typeof canvas === "string" && (
          <CanvasBlock
            content={canvas}
            title={canvasTitle}
            version={canvasVersion}
            collapsed={canvasCollapsed}
            streaming={streaming}
            onChange={onCanvasChange}
          />
        )}
        {page && onOpenPage && <PageCard page={page} onOpen={onOpenPage} />}
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
          </div>
        )}
        {!streaming && devMode && meta && <RequestBreakdown meta={meta} />}
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
  prev.canvas === next.canvas &&
  prev.canvasTitle === next.canvasTitle &&
  prev.canvasVersion === next.canvasVersion &&
  prev.canvasCollapsed === next.canvasCollapsed &&
  prev.onCanvasChange === next.onCanvasChange &&
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
  prev.thinking === next.thinking &&
  prev.thinkingMs === next.thinkingMs &&
  prev.thinkingDone === next.thinkingDone,
);
