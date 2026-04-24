import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar, type Conversation } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatIndex } from "@/components/ChatIndex";
import { ModelPicker } from "@/components/ModelPicker";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRight, Plus, Square, Paperclip, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODEL, AUTO_MODEL_ID, routeAuto, providerForModel, type Provider } from "@/lib/models";
import { loadAttachment, type Attachment } from "@/lib/attachments";
import { SlashCommandMenu, filterSlashItems, type SlashItem } from "@/components/SlashCommandMenu";
import { getTextareaCaretCoords } from "@/lib/caret";
import { ClarifyCard, type ClarifyQuestion } from "@/components/ClarifyCard";
import type { RequestMeta } from "@/lib/requestMeta";
import { billingMultiplier } from "@/lib/pricing";

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";
type Source = { title: string; url: string };
type Msg = { id?: string; role: "user" | "assistant"; content: string; provider?: Provider; model?: string; memory?: { added: number; updated: number }; tool?: ToolUse; phase?: Phase; sources?: Source[]; meta?: RequestMeta };

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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [clarify, setClarify] = useState<ClarifyQuestion[] | null>(null);
  // Title generation animation: convId -> { target, shown }. "pending" = not yet received.
  const [titleAnim, setTitleAnim] = useState<Record<string, { target: string | null; shown: string }>>({});
  const titleTimerRef = useRef<Record<string, number>>({});
  const [slash, setSlash] = useState<{
    query: string;
    start: number;
    pos: { left: number; top: number };
  } | null>(null);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string>("");
  const lastAttachmentsRef = useRef<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea height based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
    setClarify(null);
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

  // Scroll behavior:
  // - On conversation load: pin to the bottom once.
  // - When streaming starts: scroll once so the last user message sits at the top of the
  //   viewport, then stop auto-scrolling so the user can read from the start of the answer.
  // - When streaming ends: do NOT auto-scroll — keep the user where they are reading.
  const didInitialStreamScrollRef = useRef(false);
  const lastStreamUserIdRef = useRef<string | null>(null);

  // Initial pin-to-bottom when switching conversations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [activeId]);

  // Reset the per-turn streaming flag when streaming stops.
  useEffect(() => {
    if (!streaming) {
      didInitialStreamScrollRef.current = false;
      lastStreamUserIdRef.current = null;
    }
  }, [streaming]);

  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (!el) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && m.id);
    if (!lastUser?.id) return;

    // Keep trying during streaming until the last user bubble actually reaches the top.
    if (didInitialStreamScrollRef.current && lastStreamUserIdRef.current === lastUser.id) return;
    lastStreamUserIdRef.current = lastUser.id;

    let cancelled = false;
    const tryScroll = (attempt: number) => {
      if (cancelled) return;
      const anchor = document.getElementById(`chat-anchor-${lastUser.id}`);
      if (!anchor) {
        if (attempt < 10) requestAnimationFrame(() => tryScroll(attempt + 1));
        return;
      }

      const containerRect = el.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const offset = 16;
      const distanceToTop = anchorRect.top - (containerRect.top + offset);

      // Already aligned close enough: stop auto-scrolling for this turn.
      if (Math.abs(distanceToTop) <= 8) {
        didInitialStreamScrollRef.current = true;
        return;
      }

      const targetTop = el.scrollTop + distanceToTop;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const nextTop = Math.max(0, Math.min(targetTop, maxTop));
      const canMoveMore = nextTop > el.scrollTop + 1;

      if (!canMoveMore) {
        // Not enough streamed content yet to place the user bubble at the top.
        // Leave the flag unset so the next streaming update tries again.
        return;
      }

      el.scrollTo({
        top: nextTop,
        behavior: attempt === 0 ? "smooth" : "auto",
      });

      requestAnimationFrame(() => {
        if (cancelled) return;
        const updatedAnchor = document.getElementById(`chat-anchor-${lastUser.id}`);
        if (!updatedAnchor) return;
        const updatedDistance = updatedAnchor.getBoundingClientRect().top - (el.getBoundingClientRect().top + offset);
        if (Math.abs(updatedDistance) <= 8) {
          didInitialStreamScrollRef.current = true;
        }
      });
    };

    requestAnimationFrame(() => tryScroll(0));
    return () => { cancelled = true; };
  }, [streaming, messages]);

  const newConversation = () => {
    setActiveId(null);
    setMessages([]);
  };

  const ensureConversation = async (_firstUserContent: string): Promise<string | null> => {
    if (activeId) return activeId;
    // Use a placeholder; the AI-generated title will arrive via the SSE "title" event.
    const title = "New conversation";
    const { data, error } = await supabase.from("conversations").insert({
      user_id: user!.id, title, provider, model,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Error"); return null; }
    setConversations((prev) => [data as Conversation, ...prev]);
    setActiveId(data.id);
    // Mark this conversation as awaiting an AI-generated title (sidebar will show a shimmer).
    setTitleAnim((prev) => ({ ...prev, [data.id]: { target: null, shown: "" } }));
    return data.id;
  };

  // Animate the AI-generated title character-by-character into the sidebar.
  const startTitleAnimation = (convId: string, target: string) => {
    // Cancel any prior animation for this conv.
    const prev = titleTimerRef.current[convId];
    if (prev) window.clearInterval(prev);

    setTitleAnim((p) => ({ ...p, [convId]: { target, shown: "" } }));

    let i = 0;
    const intervalId = window.setInterval(() => {
      i += 1;
      setTitleAnim((p) => {
        const cur = p[convId];
        if (!cur || cur.target !== target) return p;
        const shown = target.slice(0, i);
        return { ...p, [convId]: { ...cur, shown } };
      });
      if (i >= target.length) {
        window.clearInterval(intervalId);
        delete titleTimerRef.current[convId];
        // Clear the entry shortly after so we render the static title.
        window.setTimeout(() => {
          setTitleAnim((p) => {
            const next = { ...p };
            delete next[convId];
            return next;
          });
        }, 250);
      }
    }, 28);
    titleTimerRef.current[convId] = intervalId;
  };

  // Cleanup any running interval on unmount.
  useEffect(() => () => {
    Object.values(titleTimerRef.current).forEach((id) => window.clearInterval(id));
  }, []);

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async (overrideText?: string, overrideAttachments?: Attachment[], opts?: { skipClarify?: boolean }) => {
    const text = (overrideText ?? input).trim();
    const atts = overrideAttachments ?? attachments;
    if ((!text && atts.length === 0) || sending) return;
    setSending(true);
    setClarify(null);
    lastSentRef.current = text;
    lastAttachmentsRef.current = atts;
    if (overrideText === undefined) {
      setInput("");
      setAttachments([]);
    }

    // Resolve Auto → concrete provider/model for this turn (Auto preference is preserved)
    const userPickedAuto = model === AUTO_MODEL_ID;
    const hasImage = atts.some((a) => a.kind === "image");
    // Force a vision-capable model when images are attached and the user is on Auto
    const resolved = userPickedAuto
      ? (hasImage ? { provider: "google" as Provider, model: "gemini-2.5-pro" } : routeAuto(text))
      : { provider, model };
    const sendProvider = resolved.provider;
    const sendModel = resolved.model;
    // What we persist on the conversation: keep Auto if the user picked Auto
    const convProvider = userPickedAuto ? provider : sendProvider;
    const convModel = userPickedAuto ? AUTO_MODEL_ID : sendModel;

    // Build the textual portion of the user message (visible in history)
    const attachmentSummary = atts.length
      ? "\n\n" + atts.map((a) =>
          a.kind === "image" ? `📎 Image: ${a.name}` : `📎 File: ${a.name}`
        ).join("\n")
      : "";
    const displayContent = text + attachmentSummary;

    const convId = await ensureConversation(text || atts[0]?.name || "Attachment");
    if (!convId) { setSending(false); return; }

    // Update conversation provider/model in case it changed
    await supabase.from("conversations").update({ provider: convProvider, model: convModel }).eq("id", convId);

    // Persist user message (text only — we don't store binary attachments)
    const { data: userMsg } = await supabase.from("messages").insert({
      conversation_id: convId, user_id: user!.id, role: "user", content: displayContent,
    }).select().single();

    const baseMsgs: Msg[] = [...messages, { id: userMsg?.id, role: "user", content: displayContent }];
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
          skipClarify: opts?.skipClarify === true,
          messages: baseMsgs.map((m, i) => {
            // Only the LAST user message carries the live attachments
            const isLast = i === baseMsgs.length - 1;
            return {
              role: m.role,
              content: m.content,
              attachments: isLast && m.role === "user" ? atts : undefined,
            };
          }),
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
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: snapshot,
            provider: sendProvider,
            model: sendModel,
          };
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
            } else if (j.type === "phase") {
              const phase: Phase = j.phase;
              setMessages((prev) => {
                const next = prev.slice();
                next[next.length - 1] = { ...next[next.length - 1], phase };
                return next;
              });
            } else if (j.type === "tool") {
              const tool: ToolUse = {
                tool: j.tool,
                label: String(j.label ?? ""),
                status: (j.status as ToolStatus) ?? "running",
              };
              setMessages((prev) => {
                const next = prev.slice();
                next[next.length - 1] = { ...next[next.length - 1], tool };
                return next;
              });
            } else if (j.type === "sources") {
              const sources: Source[] = Array.isArray(j.sources)
                ? j.sources.filter((s: any) => s && typeof s.url === "string").map((s: any) => ({
                    title: String(s.title ?? s.url),
                    url: String(s.url),
                  }))
                : [];
              if (sources.length) {
                setMessages((prev) => {
                  const next = prev.slice();
                  next[next.length - 1] = { ...next[next.length - 1], sources };
                  return next;
                });
              }
            } else if (j.type === "title" && j.title) {
              const newTitle = String(j.title);
              setConversations((prev) =>
                prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c)),
              );
              startTitleAnimation(convId, newTitle);
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
            } else if (j.type === "meta") {
              const meta: RequestMeta = {
                provider: String(j.provider ?? ""),
                model: String(j.model ?? ""),
                systems: Array.isArray(j.systems) ? j.systems : [],
                history: Array.isArray(j.history) ? j.history : [],
                memoryKeywords: Array.isArray(j.memoryKeywords) ? j.memoryKeywords : [],
                memoryMatches: Array.isArray(j.memoryMatches) ? j.memoryMatches : [],
                webContext: j.webContext ?? null,
                approxTotalInputTokens: Number(j.approxTotalInputTokens) || 0,
              };
              setMessages((prev) => {
                const next = prev.slice();
                next[next.length - 1] = { ...next[next.length - 1], meta };
                return next;
              });
            } else if (j.type === "usage") {
              const inputTokens = Number(j.input_tokens) || 0;
              const outputTokens = Number(j.output_tokens) || 0;
              const inputCostUsd = Number(j.input_cost_usd) || 0;
              const outputCostUsd = Number(j.output_cost_usd) || 0;
              setMessages((prev) => {
                const next = prev.slice();
                const last = next[next.length - 1];
                if (!last) return prev;
                const modelId = last.meta?.model ?? last.model ?? "";
                const multiplier = billingMultiplier(modelId);
                const cost = {
                  inputTokens,
                  outputTokens,
                  inputCostUsd,
                  outputCostUsd,
                  multiplier,
                };
                if (last.meta) {
                  next[next.length - 1] = { ...last, meta: { ...last.meta, cost } };
                }
                return next;
              });
            } else if (j.type === "clarify") {
              const qs = Array.isArray(j.questions) ? (j.questions as ClarifyQuestion[]) : [];
              if (qs.length) {
                // Remove the empty assistant placeholder — no answer was generated yet.
                setMessages((prev) => {
                  if (prev.length && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content) {
                    return prev.slice(0, -1);
                  }
                  return prev;
                });
                setClarify(qs);
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
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: acc,
            provider: sendProvider,
            model: sendModel,
          };
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
        // Restore the prompt + attachments the user was sending
        setInput(lastSentRef.current);
        if (lastAttachmentsRef.current.length) {
          setAttachments(lastAttachmentsRef.current);
        }
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

  // ---- Slash command detection ----
  // Detect "/word" immediately before the caret (boundary: start of input or whitespace).
  const detectSlash = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)(\/[A-Za-z0-9.\-]*)$/);
    if (!m) return null;
    const token = m[1]; // e.g. "/gem"
    const start = before.length - token.length;
    return { start, query: token.slice(1) };
  };

  const updateSlashFromTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const found = detectSlash(el.value, caret);
    if (!found) {
      setSlash((s) => (s ? null : s));
      return;
    }
    // Position the menu above the textarea, horizontally aligned with the caret
    const { left } = getTextareaCaretCoords(el, found.start);
    setSlash({
      query: found.query,
      start: found.start,
      pos: { left: el.offsetLeft + left, top: el.offsetTop - 8 },
    });
  };

  const applySlashSelection = (item: SlashItem) => {
    const el = textareaRef.current;
    if (!el || !slash) return;
    const before = el.value.slice(0, slash.start);
    const after = el.value.slice((el.selectionStart ?? slash.start));
    // Remove the leading whitespace separator? No — only strip the "/xxx" itself.
    const next = before + after;
    setInput(next);
    setSlash(null);
    // Update model picker
    if (item.provider === "auto") {
      // Keep the previously chosen provider as the persistence target; switch model to AUTO
      setModel(AUTO_MODEL_ID);
    } else {
      setProvider(item.provider);
      setModel(item.model);
    }
    // Restore caret position where the "/xxx" used to start
    setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(slash.start, slash.start);
    }, 0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the slash menu is open, let it consume navigation/confirm keys
    if (slash && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Delete an assistant reply along with the user message that prompted it.
  const handleDeleteAssistant = async (assistantIdx: number) => {
    if (sending) return;
    const assistant = messages[assistantIdx];
    if (!assistant || assistant.role !== "assistant") return;
    const userIdx = assistantIdx - 1;
    const userMsg = userIdx >= 0 && messages[userIdx]?.role === "user" ? messages[userIdx] : null;

    const ids = [assistant.id, userMsg?.id].filter(Boolean) as string[];
    if (ids.length) {
      await supabase.from("messages").delete().in("id", ids);
    }
    setMessages((prev) => prev.filter((_, i) => i !== assistantIdx && i !== userIdx));
  };

  // Regenerate: remove the user/assistant pair, then re-send the same prompt.
  const handleRetryAssistant = async (assistantIdx: number) => {
    if (sending) return;
    const userIdx = assistantIdx - 1;
    const userMsg = userIdx >= 0 && messages[userIdx]?.role === "user" ? messages[userIdx] : null;
    if (!userMsg) return;
    const text = userMsg.content;
    await handleDeleteAssistant(assistantIdx);
    // small defer so state has settled before send() snapshots `messages`
    setTimeout(() => { void send(text); }, 0);
  };

  // ---- Attachments ----
  const openFilePicker = () => fileInputRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setAttachLoading(true);
    try {
      const loaded: Attachment[] = [];
      for (const f of Array.from(files)) {
        try {
          loaded.push(await loadAttachment(f));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        }
      }
      if (loaded.length) {
        setAttachments((prev) => [...prev, ...loaded].slice(0, 8));
      }
    } finally {
      setAttachLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
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
        titleAnim={titleAnim}
      />

      <main className="flex-1 flex flex-col min-w-0 relative">
        <ChatIndex
          scrollContainer={scrollEl}
          items={messages
            .map((m, i) => ({ m, i }))
            .filter(({ m }) => {
              if (m.role !== "user" || !m.id) return false;
              // Exclude clarify answer messages (built by ClarifyCard as lines starting with `**question** answer`).
              const trimmed = m.content.trim();
              if (!trimmed.startsWith("**")) return true;
              const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
              const allClarify = lines.every((l) => /^\*\*[^*]+\*\*\s/.test(l.trim()));
              return !allClarify;
            })
            .map(({ m }) => ({
              id: m.id as string,
              preview: m.content.replace(/\n+/g, " ").trim().slice(0, 60) +
                (m.content.length > 60 ? "…" : ""),
            }))}
        />
        <div
          ref={(el) => {
            (scrollRef as any).current = el;
            setScrollEl(el);
          }}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <h2 className="text-2xl font-semibold mb-2">How can I help you?</h2>
              <p className="text-muted-foreground max-w-md">
                Pick a provider and a model, then ask your question. Remember to add your API keys in the settings.
              </p>
            </div>
          ) : (
            <div className="pt-8 pb-4">
              {messages.map((m, i) => (
                <ChatMessage
                  key={m.id ?? i}
                  id={m.id}
                  role={m.role}
                  content={m.content}
                  provider={m.provider}
                  model={m.model}
                  memory={m.memory}
                  tool={m.tool}
                  phase={m.phase}
                  sources={m.sources}
                  meta={m.meta}
                  streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                  onRetry={m.role === "assistant" ? () => handleRetryAssistant(i) : undefined}
                  onDelete={m.role === "assistant" ? () => handleDeleteAssistant(i) : undefined}
                  onEdit={m.role === "user" ? () => {
                    if (sending) return;
                    const userMsg = messages[i];
                    const assistantMsg = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;
                    const ids = [userMsg?.id, assistantMsg?.id].filter(Boolean) as string[];
                    if (ids.length) {
                      void supabase.from("messages").delete().in("id", ids);
                    }
                    setMessages((prev) => prev.filter((_, idx) => idx !== i && !(assistantMsg && idx === i + 1)));
                    setInput(m.content);
                    setTimeout(() => {
                      const el = textareaRef.current;
                      if (el) {
                        el.focus();
                        el.setSelectionRange(el.value.length, el.value.length);
                      }
                    }, 0);
                  } : undefined}
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-background p-4 pb-[5px] pt-[5px] relative">
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 -top-20 h-20 bg-gradient-to-t from-background to-transparent"
          />
          <div className="max-w-2xl mx-auto">
            {clarify && (
              <ClarifyCard
                questions={clarify}
                onSkip={() => setClarify(null)}
                onSubmit={(combined) => {
                  setClarify(null);
                  void send(combined, [], { skipClarify: true });
                }}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.md,.json,.csv,.yml,.yaml"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="relative bg-card border border-border rounded-2xl transition-shadow focus-within:shadow-[0_8px_24px_-4px_hsl(0_0%_0%/0.12)]">
              {(attachments.length > 0 || attachLoading) && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="group relative flex items-center gap-2 rounded-lg border border-border bg-background pl-2 pr-7 py-1.5 text-xs"
                    >
                      {a.kind === "image" ? (
                        <img src={a.dataUrl} alt={a.name} className="w-7 h-7 rounded object-cover" />
                      ) : (
                        <FileText className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="max-w-[160px] truncate">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        aria-label="Retirer"
                        className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {attachLoading && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Reading file...
                    </div>
                  )}
                </div>
              )}
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Defer so selectionStart reflects post-update value
                  requestAnimationFrame(updateSlashFromTextarea);
                }}
                onKeyDown={onKey}
                onKeyUp={updateSlashFromTextarea}
                onClick={updateSlashFromTextarea}
                onBlur={() => setTimeout(() => setSlash(null), 100)}
                placeholder="Send a message..."
                rows={1}
                className="w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0 max-h-48 overflow-y-auto py-3.5 px-4 leading-relaxed"
              />
              {slash && (
                <SlashCommandMenu
                  query={slash.query}
                  position={slash.pos}
                  onSelect={applySlashSelection}
                  onClose={() => setSlash(null)}
                />
              )}
              <div className="flex items-center justify-between gap-[15px] px-2 pb-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                      aria-label="Add attachment"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem onClick={openFilePicker}>
                      <Paperclip className="w-4 h-4 mr-2" />
                      Attach files or images
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center gap-[15px]">
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
                      onClick={() => send()}
                      disabled={!input.trim() && attachments.length === 0}
                      className="h-9 w-9 rounded-full"
                      aria-label="Send message"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
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
