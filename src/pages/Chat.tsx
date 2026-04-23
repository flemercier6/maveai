import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar, type Conversation } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ModelPicker } from "@/components/ModelPicker";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODEL, AUTO_MODEL_ID, routeAuto, providerForModel, type Provider } from "@/lib/models";

type Msg = { id?: string; role: "user" | "assistant"; content: string; provider?: Provider; model?: string; memory?: { added: number; updated: number } };

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function Chat() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState<string>(AUTO_MODEL_ID);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string>("");

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
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setDisplayName((data?.display_name as string | null) ?? null);
      });
  }, [user]);

  // Load messages when active changes
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    const conv = conversations.find((c) => c.id === activeId);
    const convProvider = (conv?.provider as Provider) ?? "openai";
    const convModel = conv?.model;
    supabase.from("messages").select("*").eq("conversation_id", activeId).order("created_at")
      .then(({ data }) => {
        setMessages(((data ?? []) as any[]).map((m) => {
          const msgModel = m.model ?? convModel;
          const msgProvider = m.role === "assistant"
            ? (msgModel && msgModel !== "auto" ? providerForModel(msgModel) : convProvider)
            : undefined;
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            provider: msgProvider,
            model: m.role === "assistant" ? msgModel : undefined,
          };
        }));
      });
    if (conv) {
      setProvider(conv.provider as Provider);
      setModel(conv.model);
    }
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: streaming ? "auto" : "smooth",
    });
  }, [messages, streaming]);

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
  };

  const ensureConversation = async (firstUserContent: string): Promise<string | null> => {
    if (activeId) return activeId;
    const title = firstUserContent.slice(0, 60).trim() || "New conversation";
    const { data, error } = await supabase.from("conversations").insert({
      user_id: user!.id, title, provider, model,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Error"); return null; }
    setConversations((prev) => [data as Conversation, ...prev]);
    setActiveId(data.id);
    return data.id;
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    lastSentRef.current = text;
    setInput("");

    // Resolve Auto → concrete provider/model for this turn (Auto preference is preserved)
    const userPickedAuto = model === AUTO_MODEL_ID;
    const resolved = userPickedAuto ? routeAuto(text) : { provider, model };
    const sendProvider = resolved.provider;
    const sendModel = resolved.model;
    // What we persist on the conversation: keep Auto if the user picked Auto
    const convProvider = userPickedAuto ? provider : sendProvider;
    const convModel = userPickedAuto ? AUTO_MODEL_ID : sendModel;

    const convId = await ensureConversation(text);
    if (!convId) { setSending(false); return; }

    // Update conversation provider/model in case it changed
    await supabase.from("conversations").update({ provider: convProvider, model: convModel }).eq("id", convId);

    // Persist user message
    const { data: userMsg } = await supabase.from("messages").insert({
      conversation_id: convId, user_id: user!.id, role: "user", content: text,
    }).select().single();

    const baseMsgs: Msg[] = [...messages, { id: userMsg?.id, role: "user", content: text }];
    setMessages([...baseMsgs, { role: "assistant", content: "", provider: sendProvider, model: sendModel }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

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
          provider: sendProvider,
          model: sendModel,
          messages: baseMsgs.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        const t = await resp.text();
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      // Coalesce delta updates onto a single rAF tick so React renders
      // smoothly (~60fps) instead of once per token.
      let pending = false;
      const flush = () => {
        pending = false;
        const snapshot = acc;
        setMessages((prev) => {
          const next = prev.slice();
          next[next.length - 1] = { role: "assistant", content: snapshot, provider: sendProvider, model: sendModel };
          return next;
        });
      };
      const scheduleFlush = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(flush);
      };

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
              scheduleFlush();
            } else if (j.type === "title" && j.title) {
              setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, title: j.title } : c)),
              );
            } else if (j.type === "memory") {
              const mem = { added: Number(j.added) || 0, updated: Number(j.updated) || 0 };
              if (mem.added + mem.updated > 0) {
                setMessages((prev) => {
                  const next = prev.slice();
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "user") {
                      next[i] = { ...next[i], memory: mem };
                      break;
                    }
                  }
                  return next;
                });
              }
            } else if (j.type === "error") {
              throw new Error(j.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      // Final flush to make sure we render the very last delta
      if (pending || acc) {
        pending = false;
        setMessages((prev) => {
          const next = prev.slice();
          next[next.length - 1] = { role: "assistant", content: acc, provider: sendProvider, model: sendModel };
          return next;
        });
      }

      // refresh conversation list ordering
      setConversations((prev) => {
        const found = prev.find((c) => c.id === convId);
        if (!found) return prev;
        const updated = { ...found, updated_at: new Date().toISOString(), provider: convProvider, model: convModel };
        return [updated, ...prev.filter((c) => c.id !== convId)];
      });
    } catch (e) {
      const aborted = (e as any)?.name === "AbortError" || controller.signal.aborted;
      if (aborted) {
        // Restore the prompt the user was sending so they can edit/resend
        setInput(lastSentRef.current);
        // Remove the (empty) assistant placeholder and the persisted user message
        setMessages((prev) => {
          const trimmed = prev.slice(0, -1); // drop assistant placeholder
          if (trimmed.length && trimmed[trimmed.length - 1].role === "user") {
            return trimmed.slice(0, -1);
          }
          return trimmed;
        });
        if (userMsg?.id) {
          await supabase.from("messages").delete().eq("id", userMsg.id);
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      abortRef.current = null;
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
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
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
        userName={displayName ?? (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0]}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <h2 className="text-2xl font-semibold mb-2">How can I help you?</h2>
              <p className="text-muted-foreground max-w-md">
                Pick a provider and a model, then ask your question. Remember to add your API keys in the settings.
              </p>
            </div>
          ) : (
            <div className="pb-4">
              {messages.map((m, i) => (
                <ChatMessage
                  key={m.id ?? i}
                  role={m.role}
                  content={m.content}
                  provider={m.provider}
                  model={m.model}
                  memory={m.memory}
                  streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-background p-4 pb-[5px] pt-[5px]">
          <div className="max-w-3xl mx-auto">
            <div className="bg-card border border-border rounded-2xl transition-shadow focus-within:shadow-[0_8px_24px_-4px_hsl(0_0%_0%/0.12)]">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Send a message..."
                rows={1}
                className="w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 max-h-48 py-3.5 px-4"
              />
              <div className="flex items-center justify-end gap-[15px] px-2 pb-2">
                <ModelPicker
                  provider={provider}
                  model={model}
                  onChange={(p, m) => { setProvider(p); setModel(m); }}
                  disabled={streaming}
                />
                {sending ? (
                  <Button
                    size="icon"
                    onClick={stop}
                    className="h-9 w-9 rounded-full"
                    aria-label="Stop generation"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    onClick={send}
                    disabled={!input.trim()}
                    className="h-9 w-9 rounded-full"
                    aria-label="Send message"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-[5px]">
              AI can make mistakes. Always use your own judgment.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
