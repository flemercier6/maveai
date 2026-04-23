import { cn } from "@/lib/utils";
import { Sparkles, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProviderBadge } from "./ProviderBadge";
import type { Provider } from "@/lib/models";

type Props = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  provider?: Provider;
};

export function ChatMessage({ role, content, streaming, provider }: Props) {
  const isUser = role === "user";
  return (
    <div className={cn("w-full py-5", isUser ? "" : "bg-surface")}>
      <div className="max-w-3xl mx-auto px-4 flex gap-4">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
            isUser ? "bg-bubble-user text-bubble-user-foreground" : "bg-primary text-primary-foreground"
          )}
        >
          {isUser ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {isUser ? "Toi" : "Assistant"}
            </span>
            {!isUser && provider && <ProviderBadge provider={provider} />}
          </div>
          <div className={cn("chat-prose break-words", streaming && "typing-cursor")}>
            {content ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : streaming ? "" : " "}
          </div>
        </div>
      </div>
    </div>
  );
}
