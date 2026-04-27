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
import { ArrowRight, Plus, Square, Paperclip, X, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODEL, AUTO_MODEL_ID, routeAuto, providerForModel, type Provider } from "@/lib/models";
import { loadAttachment, type Attachment } from "@/lib/attachments";
import { SlashCommandMenu, filterSlashItems, type SlashItem } from "@/components/SlashCommandMenu";
import { getTextareaCaretCoords } from "@/lib/caret";
import { ClarifyCard, type ClarifyQuestion } from "@/components/ClarifyCard";
import type { RequestMeta } from "@/lib/requestMeta";
import { billingMultiplier } from "@/lib/pricing";
import { looksLikeWritingRequest } from "@/lib/writingDetection";
import { SelectionExploreButton, type SelectionPayload } from "@/components/SelectionExploreButton";
import { ExplorePanel, type BranchSeed } from "@/components/ExplorePanel";
import type { MessageBranch } from "@/components/ChatMessage";

type StoredBranch = {
  id: string;
  source_message_id: string;
  quoted_text: string;
};

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search" | "map"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";
type Source = { title: string; url: string };
export type MsgAttachmentPreview = { kind: "image" | "file"; name: string; dataUrl?: string };
type Msg = { id?: string; role: "user" | "assistant"; content: string; provider?: Provider; model?: string; memory?: { added: number; updated: number }; tool?: ToolUse; phase?: Phase; sources?: Source[]; meta?: RequestMeta; canvas?: string; canvasTitle?: string; canvasVersion?: number; attachments?: MsgAttachmentPreview[] };

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
  // User explicitly invoked /write for the next message (forces writing canvas mode).
  const [writeRequested, setWriteRequested] = useState(false);
  // User explicitly invoked /explore — next send opens a side exploration instead of posting.
  const [exploreRequested, setExploreRequested] = useState(false);
  // Title generation animation: convId -> { target, shown }. "pending" = not yet received.
  const [titleAnim, setTitleAnim] = useState<Record<string, { target: string | null; shown: string }>>({});
  const titleTimerRef = useRef<Record<string, number>>({});
  const [slash, setSlash] = useState<{
    query: string;
    start: number;
    pos: { left: number; top: number };
  } | null>(null);

  // ---- Explore (branch) side panel ----
  const [exploreOpen, setExploreOpen] = useState(false);
  const [exploreSeed, setExploreSeed] = useState<BranchSeed | null>(null);
  const [branches, setBranches] = useState<StoredBranch[]>([]);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string>("");
  const lastAttachmentsRef = useRef<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

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
        // Re-parse persisted assistant text to recover canvas blocks & titles.
        const parseStored = (raw: string): { body: string; canvas?: string; canvasTitle?: string } => {
          let rest = raw ?? "";
          const editMatch = rest.match(/^\s*CANVAS_EDIT:\s*(yes|no)\s*\n?/i);
          let editMode: "yes" | "no" | null = null;
          if (editMatch) {
            editMode = editMatch[1].toLowerCase() as "yes" | "no";
            rest = rest.slice(editMatch[0].length);
          }
          let title: string | undefined;
          const titleMatch = rest.match(/^\s*CANVAS_TITLE:\s*([^\n]+?)[ \t]*\n/i);
          if (titleMatch) {
            title = titleMatch[1].trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 60);
            rest = rest.slice(titleMatch[0].length);
          }
          if (editMode === "no") return { body: rest };
          const open = rest.indexOf("```canvas");
          if (open < 0) return { body: rest };
          const afterOpen = rest.indexOf("\n", open);
          if (afterOpen < 0) return { body: rest };
          const close = rest.indexOf("```", afterOpen + 1);
          if (close < 0) return { body: rest };
          const canvas = rest.slice(afterOpen + 1, close).replace(/\n+$/, "");
          const body = rest.slice(0, open) + rest.slice(close + 3);
          return { body, canvas, canvasTitle: title };
        };
        let canvasCounter = 0;
        setMessages(((data ?? []) as any[]).map((m) => {
          const msgModel = m.model ?? convModel;
          const msgProvider = m.role === "assistant"
            ? (msgModel && msgModel !== "auto" ? providerForModel(msgModel) : convProvider)
            : undefined;
          if (m.role === "assistant") {
            const parsed = parseStored(m.content);
            const hasCanvas = typeof parsed.canvas === "string";
            if (hasCanvas) canvasCounter += 1;
            return {
              id: m.id,
              role: m.role,
              content: parsed.body,
              provider: msgProvider,
              model: msgModel,
              ...(hasCanvas ? { canvas: parsed.canvas, canvasTitle: parsed.canvasTitle, canvasVersion: canvasCounter } : {}),
            };
          }
          // Parse legacy "📎 Image: name" / "📎 File: name" trailing lines into attachment chips.
          const raw = (m.content ?? "") as string;
          const attRe = /\n*📎\s+(Image|File):\s*([^\n]+)\s*$/;
          const userAtts: MsgAttachmentPreview[] = [];
          let body = raw;
          let match: RegExpMatchArray | null;
          while ((match = body.match(attRe))) {
            userAtts.unshift({
              kind: match[1] === "Image" ? "image" : "file",
              name: match[2].trim(),
            });
            body = body.slice(0, match.index!).replace(/\s+$/, "");
          }
          return {
            id: m.id,
            role: m.role,
            content: body,
            provider: msgProvider,
            model: m.role === "assistant" ? msgModel : undefined,
            ...(userAtts.length ? { attachments: userAtts } : {}),
          };
        }));
      });
    if (conv) {
      setProvider(conv.provider as Provider);
      setModel(conv.model);
    }
  }, [activeId]);

  // Load existing branches (explorations) for this conversation.
  // Only show branches that actually contain at least one message — empty
  // explorations (discarded by the user) are hidden and cleaned up.
  useEffect(() => {
    if (!activeId) { setBranches([]); return; }
    (async () => {
      const { data: rows } = await supabase
        .from("chat_branches")
        .select("id, source_message_id, quoted_text")
        .eq("conversation_id", activeId)
        .order("created_at", { ascending: true });
      const all = (rows ?? []) as any[];
      if (all.length === 0) { setBranches([]); return; }
      const ids = all.map((b) => b.id);
      const { data: msgs } = await supabase
        .from("branch_messages")
        .select("branch_id")
        .in("branch_id", ids);
      const nonEmpty = new Set<string>((msgs ?? []).map((m: any) => m.branch_id));
      setBranches(
        all
          .filter((b) => nonEmpty.has(b.id))
          .map((b) => ({
            id: b.id,
            source_message_id: b.source_message_id,
            quoted_text: b.quoted_text ?? "",
          })),
      );
    })();
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

  // Global shortcut: Cmd/Ctrl + N → new chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      newConversation();
      textareaRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

    // /explore flow: route this request to a side exploration instead of the main chat.
    if (exploreRequested) {
      if (!text) {
        toast.info("Type something to explore.");
        return;
      }
      const resolved = model === AUTO_MODEL_ID ? routeAuto(text) : { provider, model };
      const parentHistory = activeId
        ? messages
            .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
        : [];
      setExploreSeed({
        conversationId: activeId ?? null,
        sourceMessageId: null,
        quotedText: "",
        parentHistory,
        provider: resolved.provider,
        model: resolved.model,
        initialPrompt: text,
      });
      setExploreOpen(true);
      setExploreRequested(false);
      if (overrideText === undefined) {
        setInput("");
        setAttachments([]);
      }
      return;
    }
    setSending(true);
    setClarify(null);
    lastSentRef.current = text;
    lastAttachmentsRef.current = atts;
    if (overrideText === undefined) {
      setInput("");
      setAttachments([]);
    }

    // ---- Writing canvas mode ----
    // Enabled when the user typed "/write" or the message looks like a drafting task,
    // OR when the most recent assistant reply already contains a canvas (follow-up edits).
    const lastAssistantWithCanvas = [...messages].reverse().find(
      (m) => m.role === "assistant" && typeof m.canvas === "string" && m.canvas.length > 0,
    );
    const writingMode = writeRequested || looksLikeWritingRequest(text) || !!lastAssistantWithCanvas;
    const previousCanvas = lastAssistantWithCanvas?.canvas ?? null;
    if (writeRequested) setWriteRequested(false);

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

    // Build the textual portion of the user message (visible in history).
    // If /write was invoked, keep the "/write " prefix in the stored/displayed
    // content so the bubble can highlight it — but strip it before sending to
    // the AI (handled below when building the payload).
    const writePrefix = writeRequested ? "/note " : "";
    const displayContent = writePrefix + text;
    const attachmentPreviews: MsgAttachmentPreview[] = atts.map((a) =>
      a.kind === "image"
        ? { kind: "image" as const, name: a.name, dataUrl: a.dataUrl }
        : { kind: "file" as const, name: a.name },
    );

    const convId = await ensureConversation(text || atts[0]?.name || "Attachment");
    if (!convId) { setSending(false); return; }

    // Update conversation provider/model in case it changed
    await supabase.from("conversations").update({ provider: convProvider, model: convModel }).eq("id", convId);

    // Persist user message. We append a compact textual summary of attachments
    // so reloads can still show that something was attached (binary data is not stored).
    const persistedSummary = atts.length
      ? "\n\n" + atts.map((a) =>
          a.kind === "image" ? `📎 Image: ${a.name}` : `📎 File: ${a.name}`
        ).join("\n")
      : "";
    const { data: userMsg } = await supabase.from("messages").insert({
      conversation_id: convId, user_id: user!.id, role: "user", content: displayContent + persistedSummary,
    }).select().single();

    const baseMsgs: Msg[] = [...messages, { id: userMsg?.id, role: "user", content: displayContent, attachments: attachmentPreviews.length ? attachmentPreviews : undefined }];
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
          writingMode,
          // When the user explicitly invoked /write, force the model to produce
          // a canvas — don't let it decide otherwise.
          forceCanvas: writeRequested === true,
          previousCanvas,
          messages: baseMsgs.map((m, i) => {
            // Only the LAST user message carries the live attachments
            const isLast = i === baseMsgs.length - 1;
            // Strip the visible "/note " prefix from the content sent to the AI.
            const cleaned = m.role === "user"
              ? m.content.replace(/^\/note\s+/, "")
              : m.content;
            return {
              role: m.role,
              content: cleaned,
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

      // Count previous canvases in the conversation (for V1/V2 tags).
      const prevCanvasCount = messages.filter(
        (m) => m.role === "assistant" && typeof m.canvas === "string" && m.canvas.length > 0,
      ).length;

      // Parse streaming text for writing mode.
      // Expected format:
      //   CANVAS_EDIT: yes|no\n
      //   [if yes] CANVAS_TITLE: <title>\n
      //   <commentary>
      //   ```canvas\n...\n```
      // When CANVAS_EDIT is "no" we bypass canvas rendering entirely.
      const splitCanvas = (raw: string): { body: string; canvas: string | null; title: string | null; editMode: "yes" | "no" | null } => {
        let rest = raw;
        let editMode: "yes" | "no" | null = null;
        let title: string | null = null;

        const editMatch = rest.match(/^\s*CANVAS_EDIT:\s*(yes|no)\s*\n?/i);
        if (editMatch) {
          editMode = editMatch[1].toLowerCase() as "yes" | "no";
          rest = rest.slice(editMatch[0].length);
        }
        // Require the newline to be present — otherwise during streaming the
        // lazy quantifier would capture only the first character of the title.
        const titleMatch = rest.match(/^\s*CANVAS_TITLE:\s*([^\n]+?)[ \t]*\n/i);
        if (titleMatch) {
          title = titleMatch[1].trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 60);
          rest = rest.slice(titleMatch[0].length);
        }

        // If the model explicitly said "no", everything that follows is plain chat.
        if (editMode === "no") {
          return { body: rest, canvas: null, title: null, editMode };
        }

        const open = rest.indexOf("```canvas");
        if (open < 0) return { body: rest, canvas: editMode === "yes" ? "" : null, title, editMode };
        const afterOpen = rest.indexOf("\n", open);
        if (afterOpen < 0) {
          return { body: rest.slice(0, open), canvas: "", title, editMode };
        }
        const close = rest.indexOf("```", afterOpen + 1);
        if (close < 0) {
          return { body: rest.slice(0, open), canvas: rest.slice(afterOpen + 1), title, editMode };
        }
        const canvas = rest.slice(afterOpen + 1, close).replace(/\n+$/, "");
        const body = rest.slice(0, open) + rest.slice(close + 3);
        return { body, canvas, title, editMode };
      };

      // Coalesce delta updates onto a single rAF tick so React renders
      // smoothly (~60fps) instead of once per token.
      let pending = false;
      const flush = () => {
        pending = false;
        const snapshot = acc;
        const parsed = writingMode
          ? splitCanvas(snapshot)
          : { body: snapshot, canvas: null as string | null, title: null as string | null, editMode: null as "yes" | "no" | null };
        const { body, canvas, title } = parsed;
        setMessages((prev) => {
          const next = prev.slice();
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: body,
            provider: sendProvider,
            model: sendModel,
            ...(canvas !== null
              ? {
                  canvas,
                  canvasTitle: title ?? current.canvasTitle,
                  canvasVersion: current.canvasVersion ?? prevCanvasCount + 1,
                }
              : {}),
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
        const parsed = writingMode
          ? splitCanvas(acc)
          : { body: acc, canvas: null as string | null, title: null as string | null, editMode: null as "yes" | "no" | null };
        const { body, canvas, title } = parsed;
        setMessages((prev) => {
          const next = prev.slice();
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: body,
            provider: sendProvider,
            model: sendModel,
            ...(canvas !== null
              ? {
                  canvas,
                  canvasTitle: title ?? current.canvasTitle,
                  canvasVersion: current.canvasVersion ?? prevCanvasCount + 1,
                }
              : {}),
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
    } else if (item.provider === "write") {
      // Don't change model — just flag the next send as writing-canvas mode.
      setWriteRequested(true);
      toast.success("Writing canvas enabled for next message");
    } else if (item.provider === "explore") {
      // Flag the next send to open a side exploration instead of posting to the main chat.
      setExploreRequested(true);
    } else {
      setProvider(item.provider as Provider);
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

  // Open the explore side panel with the given text selection as seed.
  const openExplore = (payload: SelectionPayload) => {
    if (!activeId) return;
    // Build parent history: every message up to and including the source message.
    const sourceIdx = messages.findIndex((m) => m.id === payload.messageId);
    if (sourceIdx < 0) return;
    const parentHistory = messages
      .slice(0, sourceIdx + 1)
      .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    setExploreSeed({
      conversationId: activeId,
      sourceMessageId: payload.messageId,
      quotedText: payload.text,
      parentHistory,
      provider,
      model: model === AUTO_MODEL_ID ? "gpt-4o-mini" : model,
    });
    setExploreOpen(true);
  };

  // Reopen an existing branch by id (clicked on a chat indicator tag).
  const openExistingBranch = (branchId: string) => {
    if (!activeId) return;
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    const sourceIdx = messages.findIndex((m) => m.id === branch.source_message_id);
    if (sourceIdx < 0) return;
    const parentHistory = messages
      .slice(0, sourceIdx + 1)
      .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    setExploreSeed({
      conversationId: activeId,
      sourceMessageId: branch.source_message_id,
      quotedText: branch.quoted_text,
      parentHistory,
      provider,
      model: model === AUTO_MODEL_ID ? "gpt-4o-mini" : model,
      existingBranchId: branch.id,
    });
    setExploreOpen(true);
  };

  // Compute per-message branch chips. "selection" when quoted text differs
  // from the full message content; "full" otherwise.
  const branchesByMessage: Record<string, MessageBranch[]> = {};
  for (const b of branches) {
    const msg = messages.find((m) => m.id === b.source_message_id);
    if (!msg) continue;
    const isFull = !b.quoted_text || b.quoted_text.trim() === msg.content.trim();
    const entry: MessageBranch = {
      id: b.id,
      quotedText: b.quoted_text,
      kind: isFull ? "full" : "selection",
    };
    (branchesByMessage[b.source_message_id] ??= []).push(entry);
  }

  // Insert a merged summary back into the main chat as a new assistant message.
  const handleMergeSummary = async (summary: string) => {
    if (!activeId || !user) return;
    const body = `**Merged from exploration**\n\n${summary}`;
    const { data } = await supabase
      .from("messages")
      .insert({
        conversation_id: activeId,
        user_id: user.id,
        role: "assistant",
        content: body,
      })
      .select()
      .single();
    setMessages((prev) => [
      ...prev,
      { id: data?.id, role: "assistant", content: body, provider, model },
    ]);
    toast.success("Exploration merged into the main chat");
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

      <div className="flex-1 flex min-w-0 relative" style={{ backgroundColor: "#F8F8F8" }}>
      <main
        className="flex-1 flex flex-col min-w-0 relative bg-background"
        style={exploreOpen ? { borderTopRightRadius: 15, borderBottomRightRadius: 15, overflow: "hidden" } : undefined}
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          dragCounterRef.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setIsDragging(false);
        }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDragging(false);
          const files = e.dataTransfer?.files;
          if (files && files.length) void handleFiles(files);
        }}
      >
        <div
          className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none cursor-copy bg-background/60 backdrop-blur-md transition-opacity duration-200 ease-out ${
            isDragging ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={`flex flex-col items-center gap-3 px-8 py-6 transition-all duration-200 ease-out ${
              isDragging ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
          >
            <Upload className="w-8 h-8 text-foreground" />
            <div className="text-base font-semibold text-foreground">Drop to add to context</div>
            <div className="text-xs text-muted-foreground">Image, PDF or text — up to 15 MB</div>
          </div>
        </div>
        <header className="flex items-center h-12 px-4 border-b border-border shrink-0">
          <span className="text-sm font-semibold truncate">Chat</span>
        </header>
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
              {(() => {
                // Find the index of the most recent assistant message that has a canvas,
                // so older canvases can be collapsed/greyed with their V{n} tag.
                let latestCanvasIdx = -1;
                for (let i = messages.length - 1; i >= 0; i--) {
                  const m = messages[i];
                  if (m.role === "assistant" && typeof m.canvas === "string" && m.canvas.length > 0) {
                    latestCanvasIdx = i;
                    break;
                  }
                }
                return messages.map((m, i) => (
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
                  canvas={m.canvas}
                  canvasTitle={m.canvasTitle}
                  attachments={m.attachments}
                  canvasVersion={m.canvasVersion}
                  canvasCollapsed={typeof m.canvas === "string" && latestCanvasIdx >= 0 && i !== latestCanvasIdx}
                  onCanvasChange={m.role === "assistant" && typeof m.canvas === "string" && i === latestCanvasIdx ? (next) => {
                    setMessages((prev) => {
                      const arr = prev.slice();
                      arr[i] = { ...arr[i], canvas: next };
                      return arr;
                    });
                  } : undefined}
                  streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                  onRetry={m.role === "assistant" ? () => handleRetryAssistant(i) : undefined}
                  onDelete={m.role === "assistant" ? () => handleDeleteAssistant(i) : undefined}
                  onExplore={m.role === "assistant" && m.id && m.content ? () => openExplore({ text: m.content, messageId: m.id as string }) : undefined}
                  branches={m.role === "assistant" && m.id ? branchesByMessage[m.id] : undefined}
                  onBranchOpen={m.role === "assistant" ? openExistingBranch : undefined}
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
              ));
              })()}
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
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
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
              </div>
              {slash && (
                <SlashCommandMenu
                  query={slash.query}
                  position={slash.pos}
                  onSelect={applySlashSelection}
                  onClose={() => setSlash(null)}
                />
              )}
              <div className="flex items-center justify-between gap-[15px] px-2 pb-2">
                <div className="flex items-center gap-2">
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
                  {writeRequested && (
                    <button
                      type="button"
                      onClick={() => setWriteRequested(false)}
                      aria-label="Remove Note"
                      className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium bg-[#E6F1FF] transition-colors"
                      style={{ color: "#0062FF" }}
                    >
                      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                        <FileText className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "#0062FF" }} />
                        <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#0062FF" }} />
                      </span>
                      Note
                    </button>
                  )}
                  {exploreRequested && (
                    <button
                      type="button"
                      onClick={() => setExploreRequested(false)}
                      aria-label="Remove Explore"
                      className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium bg-[#E6F1FF] transition-colors"
                      style={{ color: "#0062FF" }}
                    >
                      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                        <Sparkles className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "#0062FF" }} />
                        <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#0062FF" }} />
                      </span>
                      Explore
                    </button>
                  )}
                </div>
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

      {/* Floating Explore button over the current selection (self-contained) */}
      {activeId && (
        <SelectionExploreButton onExplore={openExplore} disabled={exploreOpen} />
      )}

      {/* Right-hand exploration side panel */}
      <ExplorePanel
        open={exploreOpen}
        seed={exploreSeed}
        userId={user.id}
        onClose={() => setExploreOpen(false)}
        onMerge={handleMergeSummary}
        onBranchCreated={(b) =>
          setBranches((prev) =>
            prev.some((x) => x.id === b.id)
              ? prev
              : [...prev, { id: b.id, source_message_id: b.source_message_id as any, quoted_text: b.quoted_text }],
          )
        }
        onBranchDeleted={(id) =>
          setBranches((prev) => prev.filter((x) => x.id !== id))
        }
      />
      </div>
    </div>
  );
}
