import { useEffect, useRef, useState } from "react";
import { X, ArrowRight, Square, ChevronDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ChatMessage";
import { ModelPicker } from "@/components/ModelPicker";
import { toast } from "sonner";
import { providerForModel, type Provider } from "@/lib/models";
import {
  notifyComposerBlur,
  notifyComposerFocus,
  useActiveComposer,
} from "@/hooks/useActiveComposer";

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export type BranchSeed = {
  /** Optional — absent for standalone `/explore` explorations. */
  conversationId?: string | null;
  /** Optional — absent for standalone `/explore` explorations. */
  sourceMessageId?: string | null;
  /** Optional — the selected excerpt, if branched from a message. */
  quotedText?: string;
  // Messages preceding (and including) the source message, used as context.
  parentHistory: { role: "user" | "assistant"; content: string }[];
  provider: Provider;
  model: string;
  /** When set, reopen an existing branch instead of creating a new one. */
  existingBranchId?: string;
  /** Optional — first user prompt to auto-send when the panel opens. */
  initialPrompt?: string;
};

type BranchMsg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
};

type Props = {
  open: boolean;
  seed: BranchSeed | null;
  userId: string;
  onClose: () => void;
  /** Called with a summary string when the user merges the exploration back. */
  onMerge: (summary: string) => void;
  /** Called when a brand-new branch is created (so the parent can show indicators). */
  onBranchCreated?: (branch: {
    id: string;
    conversation_id: string | null;
    source_message_id: string | null;
    quoted_text: string;
  }) => void;
  /** Called when a branch is discarded (empty on close) so the parent can remove it. */
  onBranchDeleted?: (branchId: string) => void;
};

export function ExplorePanel({ open, seed, userId, onClose, onMerge, onBranchCreated, onBranchDeleted }: Props) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BranchMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sending, setSending] = useState(false);
  const [merging, setMerging] = useState(false);
  // The model used for the next assistant reply. Initialized from the seed
  // (so we inherit the main chat's pick), but the user can override it via
  // the ModelPicker below the textarea.
  const [provider, setProvider] = useState<Provider>(seed?.provider ?? "google");
  const [model, setModel] = useState<string>(seed?.model ?? "");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeComposer = useActiveComposer();
  const dimmed = activeComposer === "main";

  // Close handler: if the branch is empty (no messages persisted), discard it
  // so empty explorations don't pollute the conversation indicators.
  const handleClose = async () => {
    abortRef.current?.abort();
    const isEmpty = messages.length === 0 || messages.every((m) => !m.content || !m.content.trim());
    if (branchId && !seed?.existingBranchId && isEmpty) {
      const idToDelete = branchId;
      await supabase.from("branch_messages").delete().eq("branch_id", idToDelete);
      await supabase.from("chat_branches").delete().eq("id", idToDelete);
      onBranchDeleted?.(idToDelete);
    }
    onClose();
  };

  // Create a branch record when a seed arrives and none exists yet,
  // or load an existing branch when one is referenced.
  useEffect(() => {
    if (!open || !seed) return;
    setMessages([]);
    setInput("");
    setBranchId(null);
    // Reset model selection to the seed's defaults whenever the panel opens
    // for a new seed (new branch or reopened branch).
    setProvider(seed.provider);
    setModel(seed.model);

    if (seed.existingBranchId) {
      // Reopen existing branch: load its persisted messages.
      setBranchId(seed.existingBranchId);
      (async () => {
        const { data, error } = await supabase
          .from("branch_messages")
          .select("id, role, content, model")
          .eq("branch_id", seed.existingBranchId!)
          .order("created_at", { ascending: true });
        if (error) {
          toast.error(error.message);
          return;
        }
        setMessages(
          (data ?? []).map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            model: m.model ?? null,
          })),
        );
      })();
      return;
    }

    if (seed.existingBranchId) {
      // Reopen existing branch: load its persisted messages.
      setBranchId(seed.existingBranchId);
      (async () => {
        const { data, error } = await supabase
          .from("branch_messages")
          .select("id, role, content")
          .eq("branch_id", seed.existingBranchId!)
          .order("created_at", { ascending: true });
        if (error) {
          toast.error(error.message);
          return;
        }
        setMessages(
          (data ?? []).map((m: any) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        );
      })();
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from("chat_branches")
        .insert({
          user_id: userId,
          conversation_id: seed.conversationId ?? null,
          source_message_id: seed.sourceMessageId ?? null,
          quoted_text: seed.quotedText ?? "",
          title: "Exploration",
          status: "open",
        })
        .select()
        .single();
      if (error) {
        toast.error(error.message);
        return;
      }
      setBranchId(data.id);
      onBranchCreated?.({
        id: data.id,
        conversation_id: data.conversation_id,
        source_message_id: data.source_message_id,
        quoted_text: data.quoted_text,
      });
    })();
  }, [open, seed, userId]);

  // Auto-send an initial prompt (e.g. from /explore) once the branch is created.
  const autoSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !seed || !branchId) return;
    if (!seed.initialPrompt || !seed.initialPrompt.trim()) return;
    if (autoSentRef.current === branchId) return;
    autoSentRef.current = branchId;
    void send(seed.initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed, branchId]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Auto scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const stop = () => abortRef.current?.abort();

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !seed || !branchId || sending) return;
    if (override === undefined) setInput("");
    else setInput("");
    setSending(true);

    // Persist user message in branch.
    const { data: userMsg } = await supabase
      .from("branch_messages")
      .insert({
        user_id: userId,
        branch_id: branchId,
        role: "user",
        content: text,
      })
      .select()
      .single();

    const baseMsgs: BranchMsg[] = [
      ...messages,
      { id: userMsg?.id, role: "user", content: text },
    ];
    setMessages([...baseMsgs, { role: "assistant", content: "" }]);
    setStreaming(true);

    // Build the payload: parent history (if any), an optional bridge message
    // quoting the selection, plus the branch conversation so far.
    const hasQuote = !!(seed.quotedText && seed.quotedText.trim());
    const bridgePreamble = hasQuote
      ? `The user is opening a side exploration branched from the main conversation. ` +
        `They are focused on this excerpt from your previous response:\n\n` +
        `> ${seed.quotedText!.replace(/\n/g, "\n> ")}\n\n` +
        `Continue the discussion grounded in this excerpt, while using the prior context above. ` +
        `Stay concise unless the user asks for depth.`
      : null;

    const payloadMessages = [
      ...seed.parentHistory,
      ...(bridgePreamble
        ? [
            { role: "user" as const, content: bridgePreamble },
            { role: "assistant" as const, content: "Understood — what would you like to explore?" },
          ]
        : []),
      ...baseMsgs.map((m) => ({ role: m.role, content: m.content })),
    ];

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
          // No conversationId → the edge function won't persist, which is exactly
          // what we want (we persist to branch_messages ourselves).
          conversationId: null,
          provider: seed.provider,
          model: seed.model,
          skipClarify: true,
          writingMode: false,
          forceCanvas: false,
          messages: payloadMessages,
        }),
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(await resp.text());
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
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          try {
            const j = JSON.parse(chunk.slice(6));
            if (j.type === "delta" && typeof j.text === "string") {
              acc += j.text;
              setMessages((prev) => {
                const arr = prev.slice();
                arr[arr.length - 1] = { role: "assistant", content: acc };
                return arr;
              });
            }
          } catch { /* ignore partial */ }
        }
      }

      // Persist the assistant reply.
      if (acc.trim()) {
        const { data: asstMsg } = await supabase
          .from("branch_messages")
          .insert({
            user_id: userId,
            branch_id: branchId,
            role: "assistant",
            content: acc,
            model: seed.model,
          })
          .select()
          .single();
        setMessages((prev) => {
          const arr = prev.slice();
          arr[arr.length - 1] = {
            id: asstMsg?.id,
            role: "assistant",
            content: acc,
          };
          return arr;
        });
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast.error(e?.message ?? "Exploration failed");
      }
    } finally {
      setStreaming(false);
      setSending(false);
      abortRef.current = null;
    }
  };

  const handleMerge = async () => {
    if (!seed || !branchId || merging) return;
    if (messages.length === 0) {
      toast.info("Nothing to merge yet.");
      return;
    }
    setMerging(true);
    try {
      // Ask the same endpoint to summarize the exploration in a self-contained way.
      const summaryPrompt =
        `Summarize the following side exploration into a concise insight ` +
        `that can be inserted back into the main conversation. ` +
        `Keep it to 2–6 sentences. Start with a short bold headline.\n\n` +
        (seed.quotedText && seed.quotedText.trim()
          ? `The exploration was grounded in this excerpt:\n> ${seed.quotedText}\n\n`
          : "") +
        `Exploration messages:\n` +
        messages
          .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
          .join("\n\n");

      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(FUNC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          conversationId: null,
          provider: seed.provider,
          model: seed.model,
          skipClarify: true,
          writingMode: false,
          forceCanvas: false,
          messages: [{ role: "user", content: summaryPrompt }],
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(await resp.text());
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          try {
            const j = JSON.parse(chunk.slice(6));
            if (j.type === "delta" && typeof j.text === "string") acc += j.text;
          } catch { /* ignore */ }
        }
      }
      const summary = acc.trim();
      if (!summary) throw new Error("Empty summary");

      await supabase
        .from("chat_branches")
        .update({ status: "merged", merged_summary: summary })
        .eq("id", branchId);

      onMerge(summary);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Resizable width (px). Persisted to localStorage.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 480;
    const saved = Number(localStorage.getItem("explore-panel-width"));
    return Number.isFinite(saved) && saved >= 320 ? saved : 480;
  });
  const resizingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(
        Math.max(320, window.innerWidth - e.clientX),
        Math.max(360, window.innerWidth - 360),
      );
      setWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("explore-panel-width", String(width));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  if (!open) return null;

  return (
    <aside
      className="relative h-full shrink-0 flex flex-col animate-in slide-in-from-right duration-300"
      style={{ backgroundColor: "#F8F8F8", width }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        className="absolute top-0 left-0 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-border z-10"
        aria-label="Resize exploration panel"
      />
      <header className="flex items-center justify-between h-12 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">Exploration</span>
          {seed && (
            <span className="text-xs text-muted-foreground truncate">
              branched from chat
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleMerge}
            disabled={!branchId || messages.length === 0 || merging || streaming}
          >
            {merging ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            Merge
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleClose}
            aria-label="Close exploration"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Ask anything about this excerpt. The AI has the context of your main chat.
            </p>
          </div>
        ) : (
          <div>
            {messages.map((m, i) => {
              const isFirstUser =
                m.role === "user" &&
                i === messages.findIndex((x) => x.role === "user");
              const showQuote =
                isFirstUser && !!(seed && seed.quotedText && seed.quotedText.trim());
              return (
                <div key={m.id ?? i}>
                  {showQuote && (
                    <div className="px-4 pt-3">
                      <div className="ml-auto max-w-[85%] rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                        <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70">
                          Quoted
                        </div>
                        <blockquote className="whitespace-pre-wrap line-clamp-4 leading-snug text-foreground/80">
                          {seed!.quotedText}
                        </blockquote>
                      </div>
                    </div>
                  )}
                  <ChatMessage
                    id={m.id}
                    role={m.role}
                    content={m.content}
                    streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                    variant="explore"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input — mirrors the main chat composer's sizing & bottom spacing */}
      <div className="p-4 pb-[5px] pt-[5px]" style={{ backgroundColor: "#F8F8F8" }}>
        <div
          className={`relative bg-card border border-border rounded-2xl transition-all duration-200 focus-within:shadow-[0_8px_24px_-4px_hsl(0_0%_0%/0.12)] ${
            dimmed ? "opacity-50" : "opacity-100"
          }`}
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => notifyComposerFocus("explore")}
            onBlur={() => notifyComposerBlur("explore")}
            placeholder="Continue exploring..."
            rows={1}
            className="w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0 max-h-48 overflow-y-auto py-3.5 px-4 leading-relaxed"
          />
          <div className="flex items-center justify-end px-2 pb-2">
            {sending ? (
              <Button
                size="icon"
                onClick={stop}
                className="h-9 w-9 rounded-full"
                aria-label="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => send()}
                disabled={!input.trim() || !branchId}
                className="h-9 w-9 rounded-full"
                aria-label="Send"
              >
                <ArrowRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        {/* Spacer that matches the height of the main chat's disclaimer
            (`<p className="text-[11px] ... mt-[5px]">`), so the composer
            sits at the exact same bottom offset as in the main chat. */}
        <div aria-hidden className="text-[11px] mt-[5px] leading-normal select-none">
          &nbsp;
        </div>
      </div>
    </aside>
  );
}
