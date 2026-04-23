import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar, type Conversation } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ModelPicker } from "@/components/ModelPicker";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODEL, type Provider } from "@/lib/models";

type Msg = { id?: string; role: "user" | "assistant"; content: string; provider?: Provider };

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function Chat() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<string>(DEFAULT_MODEL.openai);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/signin", { replace: true });
  }, [loading, user, navigate]);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    supabase.from("conversations").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => {
        setConversations((data ?? []) as Conversation[]);
      });
  }, [user]);

  // Load messages when active changes
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    supabase.from("messages").select("*").eq("conversation_id", activeId).order("created_at")
      .then(({ data }) => {
        setMessages(((data ?? []) as any[]).map((m) => ({ id: m.id, role: m.role, content: m.content })));
      });
    const conv = conversations.find((c) => c.id === activeId);
    if (conv) {
      setProvider(conv.provider as Provider);
      setModel(conv.model);
    }
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
  };

  const ensureConversation = async (firstUserContent: string): Promise<string | null> => {
    if (activeId) return activeId;
    const title = firstUserContent.slice(0, 60).trim() || "Nouvelle conversation";
    const { data, error } = await supabase.from("conversations").insert({
      user_id: user!.id, title, provider, model,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Erreur"); return null; }
    setConversations((prev) => [data as Conversation, ...prev]);
    setActiveId(data.id);
    return data.id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    const convId = await ensureConversation(text);
    if (!convId) { setSending(false); return; }

    // Update conversation provider/model in case it changed
    await supabase.from("conversations").update({ provider, model }).eq("id", convId);

    // Persist user message
    const { data: userMsg } = await supabase.from("messages").insert({
      conversation_id: convId, user_id: user!.id, role: "user", content: text,
    }).select().single();

    const baseMsgs: Msg[] = [...messages, { id: userMsg?.id, role: "user", content: text }];
    setMessages([...baseMsgs, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(FUNC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          conversationId: convId,
          provider,
          model,
          messages: baseMsgs.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!resp.ok || !resp.body) {
        const t = await resp.text();
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data: ")) continue;
          try {
            const j = JSON.parse(line.slice(6));
            if (j.type === "delta") {
              acc += j.text;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: acc };
                return next;
              });
            } else if (j.type === "title" && j.title) {
              setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, title: j.title } : c)),
              );
            } else if (j.type === "error") {
              throw new Error(j.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // refresh conversation list ordering
      setConversations((prev) => {
        const found = prev.find((c) => c.id === convId);
        if (!found) return prev;
        const updated = { ...found, updated_at: new Date().toISOString(), provider, model };
        return [updated, ...prev.filter((c) => c.id !== convId)];
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement...</div>;
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newConversation}
        onDeleted={(id) => {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          if (activeId === id) { setActiveId(null); setMessages([]); }
        }}
        userEmail={user.email}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0 bg-background/80 backdrop-blur">
          <ModelPicker provider={provider} model={model} onChange={(p, m) => { setProvider(p); setModel(m); }} disabled={streaming} />
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-4">
                <Sparkles className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Comment puis-je t'aider ?</h2>
              <p className="text-muted-foreground max-w-md">
                Choisis un fournisseur et un modèle, puis pose ta question. Pense à ajouter tes clés API dans les paramètres.
              </p>
            </div>
          ) : (
            <div className="pb-4">
              {messages.map((m, i) => (
                <ChatMessage
                  key={m.id ?? i}
                  role={m.role}
                  content={m.content}
                  streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-background p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end bg-card border border-border rounded-2xl shadow-soft focus-within:border-primary/50 transition">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Envoie un message..."
                rows={1}
                className="flex-1 resize-none border-0 bg-transparent focus-visible:ring-0 max-h-48 py-3.5 pl-4 pr-14"
              />
              <Button
                size="icon"
                onClick={send}
                disabled={!input.trim() || sending}
                className="absolute right-2 bottom-2 h-9 w-9 rounded-xl"
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              Les réponses viennent directement de {provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "Google"} avec ta clé.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
