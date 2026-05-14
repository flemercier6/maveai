import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MessageSquare } from "lucide-react";

type Conv = { id: string; title: string };
type Msg = { id: string; role: string; content: string; created_at: string };

export default function SharedChat() {
  const { token } = useParams<{ token: string }>();
  const [conv, setConv] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase
        .from("conversations")
        .select("id, title")
        .eq("share_token", token)
        .eq("is_public", true)
        .maybeSingle();
      if (cancelled) return;
      if (!c) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setConv(c as Conv);
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setMessages((msgs ?? []) as Msg[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (notFound || !conv) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <MessageSquare className="w-8 h-8 text-muted-foreground" />
        <h1 className="font-semibold text-lg">Conversation not found</h1>
        <p className="text-sm text-muted-foreground">
          This share link is invalid or has been disabled.
        </p>
        <Link to="/" className="text-sm underline mt-2">Go home</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 px-4 sm:px-6 py-3 flex items-center justify-between">
        <h1 className="font-semibold truncate text-base">{conv.title || "Shared conversation"}</h1>
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          Open app →
        </Link>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages in this conversation.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {m.role === "user" ? "User" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {m.content}
            </div>
          </div>
        ))}
        <div className="pt-6 text-[11px] text-muted-foreground border-t border-border/50">
          Read-only public view.
        </div>
      </main>
    </div>
  );
}
