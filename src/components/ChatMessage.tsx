import { cloneElement, isValidElement, memo, useState, type ReactNode } from "react";
import { Brain, Copy, Check, RotateCcw, Trash2, Globe, Search, ExternalLink, ArrowUpRight, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Provider } from "@/lib/models";
import { useSmoothText } from "@/hooks/useSmoothText";

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";
type Source = { title: string; url: string };

type Props = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  provider?: Provider;
  model?: string;
  memory?: { added: number; updated: number };
  tool?: ToolUse;
  phase?: Phase;
  sources?: Source[];
  onRetry?: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
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
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors"
    >
      {children}
    </button>
  );
}

function ToolBadge({ tool, label }: ToolUse) {
  const Icon = tool === "scrape" ? Globe : Search;
  const text = tool === "scrape" ? "Read page" : "Web search";
  // Truncate long URLs/queries
  const shortLabel = label.length > 60 ? label.slice(0, 57) + "…" : label;
  return (
    <div className="inline-flex items-center h-6 gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground max-w-full">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{text}: {shortLabel}</span>
    </div>
  );
}

function getStatusMessage(phase: Phase | undefined, tool: ToolUse | undefined): string {
  if (tool) {
    const short = tool.label.length > 50 ? tool.label.slice(0, 47) + "…" : tool.label;
    if (tool.status === "done") {
      return tool.tool === "scrape" ? "Summarizing page…" : "Summarizing results…";
    }
    if (tool.status === "failed") {
      return "Tool unavailable, continuing without it…";
    }
    // running
    return tool.tool === "scrape"
      ? `Reading ${short}…`
      : `Searching: "${short}"…`;
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

const SOURCE_RE = /\s*\[source:\s*([\d,\s]+)\]/gi;

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
  const renderBlock = (Tag: "p" | "li" | "blockquote", children: ReactNode, props: any) => {
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
    p: ({ node, children, ...props }: any) => renderBlock("p", children, props),
    li: ({ node, children, ...props }: any) => renderBlock("li", children, props),
    blockquote: ({ node, children, ...props }: any) => renderBlock("blockquote", children, props),
  };
}

function ChatMessageImpl({
  role,
  content,
  streaming,
  provider,
  model,
  memory,
  tool,
  phase,
  sources,
  onRetry,
  onDelete,
}: Props) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
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
    return (
      <div className="w-full py-3">
        <div className="max-w-3xl mx-auto px-4 flex flex-col items-end gap-1.5">
          <div className="max-w-[80%] rounded-2xl bg-bubble-user text-bubble-user-foreground px-4 py-2.5 chat-prose break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content}</ReactMarkdown>
          </div>
          {memory && <MemoryBadge added={memory.added} updated={memory.updated} />}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full my-[50px]">
      <div className="max-w-3xl mx-auto px-4">
        {(provider || (tool && tool.status !== "failed")) && (
          <div className="mb-1.5 flex items-center flex-wrap" style={{ gap: "10px" }}>
            {provider && <ProviderBadge provider={provider} model={model} />}
            {tool && tool.status !== "failed" && <ToolBadge tool={tool.tool} label={tool.label} />}
          </div>
        )}
        <div className="chat-prose break-words">
          {display ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{display}</ReactMarkdown>
          ) : streaming ? (
            <span className="text-shimmer text-sm font-medium">
              {getStatusMessage(phase, tool)}
            </span>
          ) : " "}
        </div>
        {!streaming && content && (
          <div className="mt-2 flex items-center gap-1 -ml-1.5">
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
          </div>
        )}
      </div>
    </div>
  );
}

// Memoize so historical messages don't re-render on every streaming tick.
export const ChatMessage = memo(ChatMessageImpl, (prev, next) =>
  prev.role === next.role &&
  prev.content === next.content &&
  prev.streaming === next.streaming &&
  prev.provider === next.provider &&
  prev.model === next.model &&
  prev.memory?.added === next.memory?.added &&
  prev.memory?.updated === next.memory?.updated &&
  prev.tool?.tool === next.tool?.tool &&
  prev.tool?.label === next.tool?.label &&
  prev.tool?.status === next.tool?.status &&
  prev.phase === next.phase &&
  prev.sources === next.sources &&
  prev.onRetry === next.onRetry &&
  prev.onDelete === next.onDelete,
);
