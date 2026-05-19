import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Square, ChevronDown, Loader2, FileText, X } from "lucide-react";

/** Custom "sidebar-right" icon (inherits color via currentColor). */
const SidebarRightIcon = ({ className }: { className?: string }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M10.6944 4.47222V10.6944M6.80547 0.583328H8.36103C11.2942 0.583328 12.7608 0.583328 13.672 1.49455C14.5833 2.40578 14.5833 3.87236 14.5833 6.80555V8.36111C14.5833 11.2943 14.5833 12.7609 13.672 13.6721C12.7608 14.5833 11.2942 14.5833 8.36103 14.5833H6.80547C3.87229 14.5833 2.4057 14.5833 1.49447 13.6721C0.583252 12.7609 0.583252 11.2943 0.583252 8.36111V6.80555C0.583252 3.87236 0.583252 2.40578 1.49447 1.49455C2.4057 0.583328 3.87229 0.583328 6.80547 0.583328Z"
      stroke="currentColor"
      strokeWidth="1.16667"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ChatMessage";
import { ModelPicker } from "@/components/ModelPicker";
import { toast } from "sonner";
import { AUTO_MODEL_ID, providerForModel, routeAuto, type Provider } from "@/lib/models";
import { looksLikeWritingRequest } from "@/lib/writingDetection";
import {
  SlashCommandMenu,
  filterSlashItems,
  type SlashItem,
} from "@/components/SlashCommandMenu";
import { getTextareaCaretCoords } from "@/lib/caret";
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
  canvas?: string;
  canvasTitle?: string;
  canvasVersion?: number;
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

// Parse a streamed assistant string into body / canvas / title.
// Mirrors the main chat's splitCanvas so the writing-canvas (/note) feature
// works identically inside the exploration side panel.
function splitCanvas(raw: string): {
  body: string;
  canvas: string | null;
  title: string | null;
  editMode: "yes" | "no" | null;
} {
  let rest = raw;
  let editMode: "yes" | "no" | null = null;
  let title: string | null = null;

  const editMatch = rest.match(/^\s*CANVAS_EDIT:\s*(yes|no)\s*\n?/i);
  if (editMatch) {
    editMode = editMatch[1].toLowerCase() as "yes" | "no";
    rest = rest.slice(editMatch[0].length);
  }
  const titleMatch = rest.match(/^\s*CANVAS_TITLE:\s*([^\n]+?)[ \t]*\n/i);
  if (titleMatch) {
    title = titleMatch[1].trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 60);
    rest = rest.slice(titleMatch[0].length);
  }
  if (editMode === "no") return { body: rest, canvas: null, title: null, editMode };

  const open = rest.indexOf("```canvas");
  if (open < 0) return { body: rest, canvas: editMode === "yes" ? "" : null, title, editMode };
  const afterOpen = rest.indexOf("\n", open);
  if (afterOpen < 0) return { body: rest.slice(0, open), canvas: "", title, editMode };
  const close = rest.indexOf("```", afterOpen + 1);
  if (close < 0) return { body: rest.slice(0, open), canvas: rest.slice(afterOpen + 1), title, editMode };
  const canvas = rest.slice(afterOpen + 1, close).replace(/\n+$/, "");
  const body = rest.slice(0, open) + rest.slice(close + 3);
  return { body, canvas, title, editMode };
}

// Parse a persisted assistant message back into body + optional canvas/title.
function parseStored(raw: string): { body: string; canvas?: string; canvasTitle?: string } {
  const r = splitCanvas(raw ?? "");
  if (r.canvas === null) return { body: r.body };
  return { body: r.body, canvas: r.canvas, canvasTitle: r.title ?? undefined };
}

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
  // When `/note` is selected the next assistant reply opens a writing canvas,
  // identical to the main chat behavior — but scoped to the panel.
  const [writeRequested, setWriteRequested] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeComposer = useActiveComposer();
  const dimmed = activeComposer === "main";

  // Slash-command menu state (mirrors the main chat composer's behavior).
  const [slash, setSlash] = useState<{
    query: string;
    start: number;
    pos: { left: number; top: number } | null;
  } | null>(null);

  const detectSlash = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)(\/[A-Za-z0-9.\-]*)$/);
    if (!m) return null;
    const token = m[1];
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
    const after = el.value.slice(el.selectionStart ?? slash.start);
    const next = before + after;
    setInput(next);
    setSlash(null);

    if (item.provider === "auto") {
      setModel(AUTO_MODEL_ID);
    } else if (item.provider === "write") {
      // /note flags the next reply in this panel as writing-canvas mode.
      setWriteRequested(true);
      toast.success("Writing canvas enabled for next message");
    } else if (item.provider === "explore") {
      // We're already inside an exploration — surfaced as disabled below,
      // but guard here too.
      toast.info("You're already in an exploration");
    } else {
      setProvider(item.provider as Provider);
      setModel(item.model);
    }

    setTimeout(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(slash.start, slash.start);
    }, 0);
  };

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
        let canvasCounter = 0;
        setMessages(
          (data ?? []).map((m: any) => {
            if (m.role === "assistant") {
              const parsed = parseStored(m.content ?? "");
              const hasCanvas = typeof parsed.canvas === "string";
              if (hasCanvas) canvasCounter += 1;
              return {
                id: m.id,
                role: "assistant" as const,
                content: parsed.body,
                model: m.model ?? null,
                ...(hasCanvas
                  ? { canvas: parsed.canvas, canvasTitle: parsed.canvasTitle, canvasVersion: canvasCounter }
                  : {}),
              };
            }
            return {
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              model: m.model ?? null,
            };
          }),
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

  // Scroll behavior (mirrors the main chat):
  // - When streaming starts: scroll once so the last user message sits at the
  //   top of the panel viewport, then stop auto-scrolling so the user can read
  //   from the start of the answer.
  // - When streaming ends: do NOT auto-scroll — keep the user where they are.
  const didInitialStreamScrollRef = useRef(false);
  const lastStreamUserIdRef = useRef<string | null>(null);

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

      if (Math.abs(distanceToTop) <= 8) {
        didInitialStreamScrollRef.current = true;
        return;
      }

      const targetTop = el.scrollTop + distanceToTop;
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const nextTop = Math.max(0, Math.min(targetTop, maxTop));
      const canMoveMore = nextTop > el.scrollTop + 1;

      if (!canMoveMore) {
        // Wait for more streamed content to push the user bubble up.
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
        const updatedDistance =
          updatedAnchor.getBoundingClientRect().top -
          (el.getBoundingClientRect().top + offset);
        if (Math.abs(updatedDistance) <= 8) {
          didInitialStreamScrollRef.current = true;
        }
      });
    };

    requestAnimationFrame(() => tryScroll(0));
    return () => {
      cancelled = true;
    };
  }, [streaming, messages]);

  const stop = () => abortRef.current?.abort();

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !seed || !branchId || sending) return;
    if (override === undefined) setInput("");
    else setInput("");
    setSending(true);
    // Determine writing-canvas mode: explicit /note tag, a writing-style
    // request detected from the text, OR a follow-up to an existing canvas.
    const lastAssistantWithCanvas = [...messages].reverse().find(
      (m) => m.role === "assistant" && typeof m.canvas === "string" && (m.canvas as string).length > 0,
    );
    const useWriting =
      writeRequested || looksLikeWritingRequest(text) || !!lastAssistantWithCanvas;
    const forceCanvas = writeRequested === true;
    if (writeRequested) setWriteRequested(false);

    // Resolve Auto → concrete provider/model for this turn. Preserve the user's
    // Auto choice in panel state so the chip stays on Auto after sending.
    const userPickedAuto = model === AUTO_MODEL_ID;
    const resolved = userPickedAuto ? routeAuto(text) : { provider, model };
    const sendProvider = resolved.provider;
    const sendModel = resolved.model;

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

    // Pre-compute the canvas version number for the upcoming reply.
    const prevCanvasCount = messages.filter(
      (m) => m.role === "assistant" && typeof m.canvas === "string" && (m.canvas as string).length > 0,
    ).length;

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
          conversationId: null,
          provider: sendProvider,
          model: sendModel,
          skipClarify: true,
          writingMode: useWriting,
          forceCanvas,
          previousCanvas: lastAssistantWithCanvas?.canvas ?? null,
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
                const current = arr[arr.length - 1] ?? { role: "assistant", content: "" };
                if (useWriting) {
                  const parsed = splitCanvas(acc);
                  arr[arr.length - 1] = {
                    ...current,
                    role: "assistant",
                    content: parsed.body,
                    model: sendModel,
                    ...(parsed.canvas !== null
                      ? {
                          canvas: parsed.canvas,
                          canvasTitle: parsed.title ?? current.canvasTitle,
                          canvasVersion: current.canvasVersion ?? prevCanvasCount + 1,
                        }
                      : {}),
                  };
                } else {
                  arr[arr.length - 1] = { ...current, role: "assistant", content: acc, model: sendModel };
                }
                return arr;
              });
            }
          } catch { /* ignore partial */ }
        }
      }

      // Persist the assistant reply (raw `acc` so canvas blocks survive reload).
      if (acc.trim()) {
        const { data: asstMsg } = await supabase
          .from("branch_messages")
          .insert({
            user_id: userId,
            branch_id: branchId,
            role: "assistant",
            content: acc,
            model: sendModel,
          })
          .select()
          .single();
        setMessages((prev) => {
          const arr = prev.slice();
          const current = arr[arr.length - 1] ?? { role: "assistant", content: "" };
          if (useWriting) {
            const parsed = splitCanvas(acc);
            arr[arr.length - 1] = {
              ...current,
              id: asstMsg?.id,
              role: "assistant",
              content: parsed.body,
              model: sendModel,
              ...(parsed.canvas !== null
                ? {
                    canvas: parsed.canvas,
                    canvasTitle: parsed.title ?? current.canvasTitle,
                    canvasVersion: current.canvasVersion ?? prevCanvasCount + 1,
                  }
                : {}),
            };
          } else {
            arr[arr.length - 1] = {
              ...current,
              id: asstMsg?.id,
              role: "assistant",
              content: acc,
              model: sendModel,
            };
          }
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
    // When the slash menu is open, let it consume navigation/confirm keys.
    if (slash && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Track mobile to render the panel as a full-screen overlay.
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Resizable width (px). Persisted to localStorage. On mobile we ignore
  // the saved width and use the full viewport instead.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 480;
    const saved = Number(localStorage.getItem("explore-panel-width"));
    return Number.isFinite(saved) && saved >= 320 ? saved : 480;
  });
  const effectiveWidth = isMobile && typeof window !== "undefined" ? window.innerWidth : width;
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

  // Keep the panel mounted briefly after `open` flips to false so the
  // horizontal slide-out animation (width + translate) can play before
  // unmounting. We animate width and translate together so the slot itself
  // shrinks/grows in lockstep with the content — no naked gap appears
  // behind the sliding content.
  const OPEN_MS = 420;
  const CLOSE_MS = 240;
  // Opening: decelerate (iOS-like). Closing: accelerate so motion starts
  // immediately under the cursor with no perceived delay.
  const OPEN_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const CLOSE_EASE = "cubic-bezier(0.4, 0, 1, 1)";
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  // Step 1: react to `open` to mount/unmount.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    // Trigger close transition first.
    setEntered(false);
    const t = window.setTimeout(() => setMounted(false), CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  // Step 2: once the collapsed frame has been committed to the DOM,
  // flip `entered` to true on the next animation frame so the browser
  // animates from width:0 / translateX(100%) to the open state.
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    // Ensure we start collapsed for the first paint.
    setEntered(false);
    const raf = window.requestAnimationFrame(() => {
      // Second rAF guarantees the collapsed frame has been painted.
      window.requestAnimationFrame(() => setEntered(true));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [mounted, open]);

  if (!mounted) return null;

  const activeMs = entered ? OPEN_MS : CLOSE_MS;
  const activeEase = entered ? OPEN_EASE : CLOSE_EASE;

  return (
    <aside
      className={
        isMobile
          ? "fixed inset-0 z-50 h-full flex flex-col overflow-hidden"
          : "relative h-full shrink-0 flex flex-col overflow-hidden"
      }
      style={{
        backgroundColor: "#F8F8F8",
        width: entered ? effectiveWidth : 0,
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 0,
        transition: `width ${activeMs}ms ${activeEase}`,
        willChange: "width",
      }}
    >
      <div
        className="flex flex-col h-full"
        style={{
          width: effectiveWidth,
          transform: entered ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${activeMs}ms ${activeEase}`,
          willChange: "transform",
        }}
      >
      {/* Resize handle — desktop only */}
      {!isMobile && (
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
      )}
      <header className="flex items-center justify-between h-12 pl-2 pr-4 border-b border-border/30 shrink-0 text-base">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate text-base">Thread</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleClose}
            aria-label="Close exploration"
          >
            <SidebarRightIcon className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
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
                      <div className="ml-auto max-w-[85%] px-3 py-2 text-xs">
                        <blockquote
                          className="whitespace-pre-wrap line-clamp-4 leading-snug italic text-right"
                          style={{
                            backgroundImage: "linear-gradient(to right, #888888, #E0E0E0)",
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            color: "transparent",
                            WebkitTextFillColor: "transparent",
                          }}
                        >
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
                    provider={m.model ? providerForModel(m.model) : undefined}
                    model={m.model ?? undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input — mirrors the main chat composer's sizing & bottom spacing */}
      <div className="pr-4 pl-0 pb-[5px] pt-[5px]" style={{ backgroundColor: "#F8F8F8" }}>
        <div
          className={`relative bg-card border border-border rounded-2xl transition-all duration-200 focus-within:shadow-[0_8px_24px_-4px_hsl(0_0%_0%/0.12)] ${
            dimmed ? "opacity-50" : "opacity-100"
          }`}
        >
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
            onFocus={() => notifyComposerFocus("explore")}
            onBlur={() => {
              notifyComposerBlur("explore");
              setTimeout(() => setSlash(null), 100);
            }}
            placeholder="Continue exploring..."
            rows={1}
            className="w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-0 max-h-48 overflow-y-auto py-3.5 px-4 leading-relaxed"
          />
          {slash && (
            <SlashCommandMenu
              query={slash.query}
              position={slash.pos}
              onSelect={applySlashSelection}
              onClose={() => setSlash(null)}
              excludeProviders={["explore"]}
            />
          )}
          <div className="flex items-center justify-between gap-[15px] px-2 pb-2">
            <div className="flex items-center gap-2">
              {writeRequested && (
                <button
                  type="button"
                  onClick={() => setWriteRequested(false)}
                  aria-label="Remove Note"
                  className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium bg-[#E6F1FF] transition-colors text-base"
                  style={{ color: "#0062FF" }}
                >
                  <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                    <FileText className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "#0062FF" }} />
                    <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#0062FF" }} />
                  </span>
                  Note
                </button>
              )}
            </div>
            <div className="flex items-center gap-[15px]">
            <ModelPicker
              provider={provider}
              model={model}
              onChange={(p, m) => {
                setProvider(p);
                setModel(m);
              }}
              disabled={streaming}
            />
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
        </div>
        {/* Spacer that matches the height of the main chat's disclaimer
            (`<p className="text-[11px] ... mt-[5px]">`), so the composer
            sits at the exact same bottom offset as in the main chat. */}
        <div aria-hidden className="text-[11px] mt-[5px] leading-normal select-none">
          &nbsp;
        </div>
      </div>
      </div>
    </aside>
  );
}
