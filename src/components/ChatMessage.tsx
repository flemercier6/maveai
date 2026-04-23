import { memo, useState } from "react";
import { Brain, Copy, Check, RotateCcw, Trash2, Globe, Search } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import type { Provider } from "@/lib/models";
import { useSmoothText } from "@/hooks/useSmoothText";

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";

type Props = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  provider?: Provider;
  model?: string;
  memory?: { added: number; updated: number };
  tool?: ToolUse;
  phase?: Phase;
  onRetry?: () => void;
  onDelete?: () => void;
};

function MemoryBadge({ added, updated }: { added: number; updated: number }) {
  const total = added + updated;
  if (total <= 0) return null;
  const label =
    added > 0 && updated > 0
      ? `Mémoire mise à jour (${added} ajouté${added > 1 ? "s" : ""}, ${updated} modifié${updated > 1 ? "s" : ""})`
      : added > 0
        ? `Ajouté à la mémoire${added > 1 ? ` (${added})` : ""}`
        : `Mémoire mise à jour${updated > 1 ? ` (${updated})` : ""}`;
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
  const text = tool === "scrape" ? "Lecture de la page" : "Recherche web";
  // Truncate long URLs/queries
  const shortLabel = label.length > 60 ? label.slice(0, 57) + "…" : label;
  return (
    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground max-w-full">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{text} : {shortLabel}</span>
    </div>
  );
}

function getStatusMessage(phase: Phase | undefined, tool: ToolUse | undefined): string {
  if (tool) {
    const short = tool.label.length > 50 ? tool.label.slice(0, 47) + "…" : tool.label;
    if (tool.status === "done") {
      return tool.tool === "scrape" ? "Synthèse de la page…" : "Synthèse des résultats…";
    }
    if (tool.status === "failed") {
      return "Outil indisponible, je continue sans…";
    }
    // running
    return tool.tool === "scrape"
      ? `Lecture de ${short}…`
      : `Recherche : « ${short} »…`;
  }
  if (phase === "analyzing") return "Analyse de ta demande…";
  if (phase === "generating") return "Réflexion…";
  return "Réflexion…";
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
  onRetry,
  onDelete,
}: Props) {
  const isUser = role === "user";
  const [copied, setCopied] = useState(false);
  // Smooth typewriter for assistant messages while streaming.
  const smoothed = useSmoothText(content, !isUser && !!streaming);
  const display = isUser ? content : (streaming ? smoothed : content);

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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
          {memory && <MemoryBadge added={memory.added} updated={memory.updated} />}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full my-[50px]">
      <div className="max-w-3xl mx-auto px-4">
        {provider && (
          <div className="mb-1.5">
            <ProviderBadge provider={provider} model={model} />
          </div>
        )}
        {tool && tool.status !== "failed" && <ToolBadge tool={tool.tool} label={tool.label} />}
        <div className="chat-prose break-words">
          {display ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
          ) : streaming ? (
            <span className="text-shimmer text-sm font-medium">
              {getStatusMessage(phase, tool)}
            </span>
          ) : " "}
        </div>
        {!streaming && content && (
          <div className="mt-2 flex items-center gap-1 -ml-1.5">
            <ActionButton onClick={handleCopy} ariaLabel={copied ? "Copié" : "Copier"}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </ActionButton>
            {onRetry && (
              <ActionButton onClick={onRetry} ariaLabel="Régénérer">
                <RotateCcw className="w-4 h-4" />
              </ActionButton>
            )}
            {onDelete && (
              <ActionButton onClick={onDelete} ariaLabel="Supprimer">
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
  prev.onRetry === next.onRetry &&
  prev.onDelete === next.onDelete,
);
