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
};

export function ChatMessage({ role, content, streaming, provider, model }: Props) {
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
        {provider && (
          <div className="mb-1.5">
            <ProviderBadge provider={provider} model={model} />
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
