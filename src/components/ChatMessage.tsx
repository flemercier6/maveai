import { cn } from "@/lib/utils";
import { Sparkles, User } from "lucide-react";

type Props = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export function ChatMessage({ role, content, streaming }: Props) {
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
          <div className="text-xs font-medium text-muted-foreground mb-1">
            {isUser ? "Toi" : "Assistant"}
          </div>
          <div className={cn("chat-prose whitespace-pre-wrap break-words", streaming && "typing-cursor")}>
            {content || (streaming ? "" : " ")}
          </div>
        </div>
      </div>
    </div>
  );
}
