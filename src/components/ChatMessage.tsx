import { memo } from "react";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import type { Provider } from "@/lib/models";

type Props = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  provider?: Provider;
  model?: string;
  memory?: { added: number; updated: number };
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

function ChatMessageImpl({ role, content, streaming, provider, model, memory }: Props) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="w-full py-3">
        <div className="max-w-3xl mx-auto px-4 flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-bubble-user text-bubble-user-foreground px-4 py-2.5 chat-prose break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full py-5">
      <div className="max-w-3xl mx-auto px-4">
        {(provider || memory) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {provider && <ProviderBadge provider={provider} model={model} />}
            {memory && <MemoryBadge added={memory.added} updated={memory.updated} />}
          </div>
        )}
        <div className={cn("chat-prose break-words", streaming && "typing-cursor")}>
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : streaming ? "" : " "}
        </div>
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
  prev.memory?.updated === next.memory?.updated,
);
