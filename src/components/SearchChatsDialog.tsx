import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { MessageSquare, Loader2 } from "lucide-react";

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

type MessageHit = {
  id: string;
  conversation_id: string;
  content: string;
  conv_title: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  onSelect: (conversationId: string) => void;
};

export function SearchChatsDialog({ open, onOpenChange, conversations, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<MessageHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Reset state every time the dialog re-opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setMessageHits([]);
    }
  }, [open]);

  // Filter conversations by title (instant, client-side).
  const titleHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations.slice(0, 20);
    return conversations.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 20);
  }, [conversations, query]);

  // Search inside message contents (debounced server-side).
  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setMessageHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, content")
        .ilike("content", `%${q}%`)
        .order("created_at", { ascending: false })
        .limit(20);
      const titleById = new Map(conversations.map((c) => [c.id, c.title]));
      const hits: MessageHit[] = (data ?? [])
        .filter((m) => titleById.has(m.conversation_id))
        .map((m) => ({
          id: m.id,
          conversation_id: m.conversation_id,
          content: m.content,
          conv_title: titleById.get(m.conversation_id) ?? "Untitled",
        }));
      setMessageHits(hits);
      setLoading(false);
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, conversations]);

  const handlePick = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };

  // Build a short snippet around the matched text so the user can see context.
  const snippet = (content: string, q: string) => {
    if (!q) return content.slice(0, 120);
    const lower = content.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return content.slice(0, 120);
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + q.length + 60);
    return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search chats by title or content…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {/* shadcn's Command filters items by default; we already filter ourselves */}
        <CommandEmpty>
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </span>
          ) : (
            "No chats found."
          )}
        </CommandEmpty>

        {titleHits.length > 0 && (
          <CommandGroup heading="Chats">
            {titleHits.map((c) => (
              <CommandItem
                key={c.id}
                value={`title-${c.id}-${c.title}`}
                onSelect={() => handlePick(c.id)}
              >
                <MessageSquare className="w-3.5 h-3.5 opacity-70 mr-2" />
                <span className="truncate text-base">{c.title || "Untitled"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {messageHits.length > 0 && (
          <CommandGroup heading="In messages">
            {messageHits.map((m) => (
              <CommandItem
                key={m.id}
                value={`msg-${m.id}`}
                onSelect={() => handlePick(m.conversation_id)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className="text-xs text-muted-foreground truncate w-full">
                  {m.conv_title}
                </span>
                <span className="text-sm truncate w-full">{snippet(m.content, query)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
