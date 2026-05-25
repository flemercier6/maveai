import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ChatSidebar, type Conversation } from "@/components/ChatSidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatIndex } from "@/components/ChatIndex";
import { ModelPicker } from "@/components/ModelPicker";


import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowRight, Plus, Square, Paperclip, X, FileText, Loader2, Sparkles, Upload, Menu, LayoutDashboard, Globe } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_MODEL, AUTO_MODEL_ID, routeAuto, providerForModel, type Provider } from "@/lib/models";
import { loadAttachment, type Attachment } from "@/lib/attachments";
import { SlashCommandMenu, filterSlashItems, type SlashItem } from "@/components/SlashCommandMenu";

import {
  readEditorText,
  listChips,
  getCaretOffsetInText,
  setEditorText,
  insertChipAtCaret,
  removeChips,
  type ChipKind,
} from "@/lib/composerEditor";
import { ClarifyCard, type ClarifyQuestion } from "@/components/ClarifyCard";
import type { RequestMeta } from "@/lib/requestMeta";
import { billingMultiplier } from "@/lib/pricing";
import { looksLikeWritingRequest } from "@/lib/writingDetection";
import { SelectionExploreButton, type SelectionPayload } from "@/components/SelectionExploreButton";
import { ExplorePanel, type BranchSeed } from "@/components/ExplorePanel";
import { PagePanel } from "@/components/PagePanel";
import { ChatLightbox } from "@/components/ChatLightbox";
import type { PageSpec } from "@/components/PageRenderer";
import type { MessageBranch } from "@/components/ChatMessage";
import {
  notifyComposerBlur,
  notifyComposerFocus,
  useActiveComposer,
} from "@/hooks/useActiveComposer";
import { usePlan, isPremiumModel, FREE_DAILY_LIMIT } from "@/hooks/usePlan";
import { useAiPreferences } from "@/hooks/useAiPreferences";
import { isModeDisabled, isModelBlacklisted, pickAllowedModel, type ModeId } from "@/lib/aiPreferences";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { useSwipe } from "@/hooks/useSwipe";

import { ConversationActionsMenu } from "@/components/ConversationActionsMenu";
import { NotePanel } from "@/components/NotePanel";

type StoredBranch = {
  id: string;
  source_message_id: string;
  quoted_text: string;
  reply_count: number;
  last_activity: string | null;
  first_prompt: string | null;
};

type ToolStatus = "running" | "done" | "failed";
type ToolUse = { tool: "scrape" | "search" | "map"; label: string; status?: ToolStatus };
type Phase = "analyzing" | "generating";
type Source = { title: string; url: string };
export type MsgAttachmentPreview = { kind: "image" | "file"; name: string; dataUrl?: string };
export type ThinkingStep = { index: number; text: string };
export type AgentStep = {
  index: number;
  kind: "search" | "scrape" | "analyze" | "memory" | "gmail" | "calendar" | "drive" | "voyager" | "read_url" | "thought" | "finish" | "plan" | "hypothesis" | "challenge" | "compare" | "synthesize";
  label: string;
  intent: string;
  status: ToolStatus;
  foundCount?: number;
  sources?: Source[];
  narration: string;
  narrationDone?: boolean;
};
export type ModelRef = { provider: Provider; model: string };
import { GoogleActionCard, type GoogleAction } from "@/components/GoogleActionCard";
import { GoogleServiceLogo, type GoogleService, GOOGLE_SERVICE_LABEL } from "@/components/GoogleServiceLogo";
import { VoyagerLogo, VOYAGER_LABEL } from "@/components/VoyagerLogo";
import { VoyagerActionCard, type VoyagerAction } from "@/components/VoyagerActionCard";
type Msg = { id?: string; role: "user" | "assistant"; content: string; provider?: Provider; model?: string; memory?: { added: number; updated: number }; tool?: ToolUse; phase?: Phase; sources?: Source[]; meta?: RequestMeta; canvas?: string; canvasTitle?: string; canvasVersion?: number; attachments?: MsgAttachmentPreview[]; page?: PageSpec; thinking?: ThinkingStep[]; thinkingMs?: number; thinkingDone?: boolean; agentSteps?: AgentStep[]; googleAction?: GoogleAction; googleService?: GoogleService; voyagerAction?: VoyagerAction; voyagerService?: boolean; hasNote?: boolean; modelsUsed?: ModelRef[]; reflexion?: boolean };

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const PAGE_THEMES = ["paper", "midnight", "minimal", "forest", "slate"] as const;
type PageThemeId = (typeof PAGE_THEMES)[number];

function randomPageTheme(): PageThemeId {
  return PAGE_THEMES[Math.floor(Math.random() * PAGE_THEMES.length)];
}

function deterministicPageTheme(seed: string): PageThemeId {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return PAGE_THEMES[Math.abs(h) % PAGE_THEMES.length];
}

export default function Chat() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { id: routeConvId } = useParams<{ id: string }>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Persist the active conversation id with a freshness timestamp so it survives
  // tab switches / reloads, but expires after ~2 days of inactivity.
  const ACTIVE_ID_KEY = "chat-active-id";
  const ACTIVE_ID_TS_KEY = "chat-active-id-ts";
  const ACTIVE_ID_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
  const readPersistedActiveId = (): string | null => {
    if (typeof window === "undefined") return null;
    const id = window.localStorage.getItem(ACTIVE_ID_KEY);
    if (!id) return null;
    const tsRaw = window.localStorage.getItem(ACTIVE_ID_TS_KEY);
    const ts = tsRaw ? Number(tsRaw) : 0;
    if (!ts || Date.now() - ts > ACTIVE_ID_TTL_MS) {
      window.localStorage.removeItem(ACTIVE_ID_KEY);
      window.localStorage.removeItem(ACTIVE_ID_TS_KEY);
      return null;
    }
    return id;
  };
  const writePersistedActiveId = (id: string | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      window.localStorage.setItem(ACTIVE_ID_KEY, id);
      window.localStorage.setItem(ACTIVE_ID_TS_KEY, String(Date.now()));
    } else {
      window.localStorage.removeItem(ACTIVE_ID_KEY);
      window.localStorage.removeItem(ACTIVE_ID_TS_KEY);
    }
  };
  const [activeId, setActiveIdRaw] = useState<string | null>(() => {
    if (routeConvId) return routeConvId;
    return readPersistedActiveId();
  });
  const setActiveId = (id: string | null) => {
    setActiveIdRaw(id);
    writePersistedActiveId(id);
    // Keep URL in sync with the active conversation
    if (typeof window !== "undefined") {
      const target = id ? `/c/${id}` : "/";
      if (window.location.pathname !== target) {
        navigate(target, { replace: false });
      }
    }
  };
  // React to URL changes (back/forward, direct link, sharing)
  useEffect(() => {
    if (routeConvId && routeConvId !== activeId) {
      setActiveIdRaw(routeConvId);
      writePersistedActiveId(routeConvId);
    } else if (!routeConvId && activeId && window.location.pathname === "/") {
      // User navigated to root → clear active
      setActiveIdRaw(null);
      writePersistedActiveId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConvId]);
  const [ephemeral, setEphemeral] = useState(false);
  const plan = usePlan();
  const { prefs: aiPrefs } = useAiPreferences();
  const isFree = plan.isFree;
  const [upgradeReason, setUpgradeReason] = useState<null | "daily-limit" | "premium-model" | "memory" | "folder" | "save-chat">(null);

  // Default to normal (persisted) chat at app open. Ephemeral is opt-in
  // via the dedicated button. Free users are prompted to upgrade when
  // they try to actually save a chat (handled at the New chat / send paths).
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
  // User explicitly invoked /page — next send generates a structured one-pager.
  const [pageRequested, setPageRequested] = useState(false);
  // Persistent Web search toggle (localStorage).
  const [webEnabled, setWebEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("web-search-enabled") !== "false"; } catch { return true; }
  });
  // Reflexion mode (multi-step ReAct loop). Effort controls max iterations.
  const [reflexionRequested, setReflexionRequested] = useState(false);
  const [reflexionEffort, setReflexionEffort] = useState<"low" | "medium" | "high">("medium");
  const [clarifyRequested, setClarifyRequested] = useState(false);
  // User explicitly invoked /gmail, /calendar or /drive — next send is scoped to that Google service.
  const [googleService, setGoogleService] = useState<GoogleService | null>(null);
  // User explicitly invoked /voyager — next send is scoped to Voyager CRM.
  const [voyagerService, setVoyagerService] = useState<boolean>(false);
  // Side panel showing a generated PageSpec.
  const [pageOpen, setPageOpen] = useState(false);
  const [activePage, setActivePage] = useState<PageSpec | null>(null);
  // Note side panel (replaces inline CanvasBlock).
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteStreaming, setNoteStreaming] = useState(false);
  const [noteWidth, setNoteWidth] = useState(() => {
    try { const s = localStorage.getItem("note-panel-width"); return s ? Math.max(380, parseInt(s)) : 520; }
    catch { return 520; }
  });
  const [pageWidth, setPageWidth] = useState(() => {
    try { const s = localStorage.getItem("page-panel-width"); return s ? Math.max(520, parseInt(s)) : Math.min(Math.round(window.innerWidth * 0.68), 1200); }
    catch { return 900; }
  });
  // Title generation animation: convId -> { target, shown }. "pending" = not yet received.
  const [titleAnim, setTitleAnim] = useState<Record<string, { target: string | null; shown: string }>>({});
  const titleTimerRef = useRef<Record<string, number>>({});
  const [slash, setSlash] = useState<{
    query: string;
    start: number;
    pos: { left: number; top: number };
  } | null>(null);
  const [mention, setMention] = useState<{
    query: string;
    start: number;
    pos: { left: number; top: number };
  } | null>(null);
  const [mentionActive, setMentionActive] = useState(0);

  // ---- Explore (branch) side panel ----
  const [exploreOpen, setExploreOpen] = useState(false);
  const [exploreSeed, setExploreSeed] = useState<BranchSeed | null>(null);
  const [branches, setBranches] = useState<StoredBranch[]>([]);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mobile horizontal swipe: right = open sidebar / close explore, left = close sidebar / open explore (if seed exists).
  useSwipe(rootRef, {
    onSwipeRight: () => {
      if (exploreOpen) { setExploreOpen(false); return; }
      if (!sidebarMobileOpen) setSidebarMobileOpen(true);
    },
    onSwipeLeft: () => {
      if (sidebarMobileOpen) { setSidebarMobileOpen(false); return; }
      if (!exploreOpen && exploreSeed) setExploreOpen(true);
    },
    // Don't hijack swipes inside scrollable lists, inputs, code blocks, or the resize handle.
    ignoreSelector:
      "textarea, input, [contenteditable='true'], .overflow-x-auto, pre, code, [data-no-swipe]",
  });

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Conversations just created locally via ensureConversation. The "load messages"
  // effect must skip these once, otherwise the empty/in-flight DB fetch races with
  // the optimistic setMessages([...user, assistant]) and wipes the UI → blank screen.
  const freshConvIdsRef = useRef<Set<string>>(new Set());

  const lastSentRef = useRef<string>("");
  const lastAttachmentsRef = useRef<Attachment[]>([]);
  const textareaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const activeComposer = useActiveComposer();
  const mainComposerDimmed = activeComposer === "explore";

  // Sync editor DOM when `input` is updated externally (clear-on-send,
  // restore-on-abort, retry-from-message). Skipped when value already matches
  // what's in the editor — i.e. when the user is just typing.
  const lastSyncedInputRef = useRef<string>("");
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (readEditorText(el) === input) {
      lastSyncedInputRef.current = input;
      return;
    }
    setEditorText(el, input);
    lastSyncedInputRef.current = input;
  }, [input]);

  // Anonymous users are allowed — they use the app in free mode without
  // cloud persistence. The AuthPopover lets them sign in at any time.

  // Clear active conversation only when a DIFFERENT user signs in. Supabase fires
  // SIGNED_IN on every tab refocus / token refresh — we must not wipe state then.
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const newUid = session?.user?.id ?? null;
      const prevUid = lastUserIdRef.current;
      if (event === "SIGNED_IN" && newUid && (!prevUid || prevUid !== newUid)) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("fresh-signin", "1");
          writePersistedActiveId(null);
        }
        setActiveIdRaw(null);
        setMessages([]);
        navigate("/", { replace: true });
      }
      lastUserIdRef.current = newUid;
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load conversations
  useEffect(() => {
    if (!user) return;
    supabase.from("conversations").select("*").eq("user_id", user.id).order("updated_at", { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Conversation[];
        setConversations(list);
        // After a fresh sign-in, force a new chat (no fallback to recent).
        const freshSignin =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem("fresh-signin") === "1";
        if (freshSignin) {
          window.sessionStorage.removeItem("fresh-signin");
          setActiveIdRaw(null);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("chat-active-id");
          }
          return;
        }
        // Restore last active conversation on refresh. If the persisted id is
        // missing/invalid, fall back to the most recent conversation so users
        // never land on a blank chat.
        setActiveIdRaw((current) => {
          if (current && list.some((c) => c.id === current)) return current;
          const fallback = list[0]?.id ?? null;
          if (typeof window !== "undefined") {
            if (fallback) window.localStorage.setItem("chat-active-id", fallback);
            else window.localStorage.removeItem("chat-active-id");
          }
          return fallback;
        });
      });
    supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setDisplayName((data?.display_name as string | null) ?? null);
        setAvatarUrl((data?.avatar_url as string | null) ?? null);
      });
  }, [user]);

  const reloadProfile = () => {
    if (!user) return;
    supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setDisplayName((data?.display_name as string | null) ?? null);
        setAvatarUrl((data?.avatar_url as string | null) ?? null);
      });
  };

  // Load messages when active changes
  useEffect(() => {
    setClarify(null);
    setNoteContent("");
    setNoteTitle("");
    setNoteOpen(false);
    if (!activeId) { setMessages([]); return; }
    if (!user) { setMessages([]); return; }
    // Skip the DB reload for conversations we just created locally — the user
    // already has optimistic messages in state and the DB row is still being
    // inserted in the background. Reloading here would wipe the UI (blank screen).
    if (freshConvIdsRef.current.has(activeId)) {
      freshConvIdsRef.current.delete(activeId);
      return;
    }
    const conv = conversations.find((c) => c.id === activeId);
    const convProvider = (conv?.provider as Provider) ?? "openai";
    const convModel = conv?.model;
    supabase.from("messages").select("*").eq("conversation_id", activeId).eq("user_id", user.id).order("created_at")

      .then(({ data }) => {
        // Re-parse persisted assistant text to recover canvas blocks & titles.
        const parseStored = (raw: string): { body: string; canvas?: string; canvasTitle?: string } => {
          let rest = raw ?? "";
          // Strip CANVAS_EDIT / CANVAS_TITLE markers wherever they appear.
          const editMatch = rest.match(/(^|\n)\s*CANVAS_EDIT:\s*(yes|no)\s*(\n|$)/i);
          let editMode: "yes" | "no" | null = null;
          if (editMatch) {
            editMode = editMatch[2].toLowerCase() as "yes" | "no";
            rest = rest.slice(0, editMatch.index!) + rest.slice(editMatch.index! + editMatch[0].length);
          }
          let title: string | undefined;
          const titleMatch = rest.match(/(^|\n)\s*CANVAS_TITLE:\s*([^\n]+?)[ \t]*(\n|$)/i);
          if (titleMatch) {
            title = titleMatch[2].trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 60);
            rest = rest.slice(0, titleMatch.index!) + rest.slice(titleMatch.index! + titleMatch[0].length);
          }
          const open = rest.indexOf("```canvas");
          if (open < 0) {
            if (editMode === "yes") return { body: rest.trim(), canvas: "", canvasTitle: title };
            return { body: rest.trim() };
          }
          const afterOpen = rest.indexOf("\n", open);
          if (afterOpen < 0) return { body: rest.slice(0, open).trim(), canvas: "", canvasTitle: title };
          const close = rest.indexOf("```", afterOpen + 1);
          if (close < 0) return { body: rest.slice(0, open).trim(), canvas: rest.slice(afterOpen + 1), canvasTitle: title };
          const canvas = rest.slice(afterOpen + 1, close).replace(/\n+$/, "");
          const body = (rest.slice(0, open) + rest.slice(close + 3)).trim();
          return { body, canvas, canvasTitle: title };
        };
        let canvasCounter = 0;
        let lastCanvasContent = "";
        let lastCanvasTitle = "";
        const parsedMsgs = ((data ?? []) as any[]).map((m) => {
          const msgModel = m.model ?? convModel;
          const msgProvider = m.role === "assistant"
            ? (msgModel && msgModel !== "auto" ? providerForModel(msgModel) : convProvider)
            : undefined;
          // Rehydrate persisted meta (developer breakdown). Re-apply the local
          // billing multiplier on top of stored provider costs.
          const rehydrateMeta = (raw: unknown): RequestMeta | undefined => {
            if (!raw || typeof raw !== "object") return undefined;
            const meta = raw as RequestMeta;
            if (meta.cost) {
              meta.cost = {
                ...meta.cost,
                multiplier: billingMultiplier(msgModel ?? meta.model ?? ""),
              };
            }
            return meta;
          };
          const meta = m.role === "assistant" ? rehydrateMeta(m.meta) : undefined;
          if (m.role === "assistant") {
            // Try /page format first: summary text followed by ```page\n{json}\n```
            const pageMatch = (m.content ?? "").match(/^([\s\S]*?)\n*```page\n([\s\S]*?)\n```\s*$/);
            if (pageMatch) {
              try {
                const summary = pageMatch[1].trim();
                const parsed = JSON.parse(pageMatch[2]) as PageSpec;
                const page: PageSpec = { ...parsed, theme: parsed.theme ?? deterministicPageTheme(parsed.title) };
                return {
                  id: m.id,
                  role: m.role,
                  content: summary,
                  provider: msgProvider,
                  model: msgModel,
                  page,
                  ...(meta ? { meta } : {}),
                };
              } catch { /* fall through to canvas parsing */ }
            }
            const parsed = parseStored(m.content);
            const hasCanvas = typeof parsed.canvas === "string";
            if (hasCanvas) {
              canvasCounter += 1;
              lastCanvasContent = parsed.canvas!;
              lastCanvasTitle = parsed.canvasTitle ?? "";
            }
            const persistedSources = Array.isArray((m.meta as any)?.sources)
              ? ((m.meta as any).sources as any[])
                  .filter((s) => s && typeof s.url === "string")
                  .map((s) => ({ title: String(s.title ?? s.url), url: String(s.url) }))
              : [];
            const persistedAgentSteps = Array.isArray((m.meta as any)?.agent_steps)
              ? ((m.meta as any).agent_steps as any[]).map((s, i) => ({
                  index: s.index ?? i,
                  kind: s.kind as "search" | "scrape" | "analyze",
                  label: String(s.label ?? ""),
                  intent: String(s.intent ?? ""),
                  status: "done" as const,
                  foundCount: typeof s.foundCount === "number" ? s.foundCount : undefined,
                  narration: typeof s.narration === "string" ? s.narration : undefined,
                  narrationDone: true,
                }))
              : undefined;
            const persistedThinkingSteps = Array.isArray((m.meta as any)?.thinking_steps)
              ? ((m.meta as any).thinking_steps as any[]).map((s) => ({
                  index: s.index as number,
                  text: String(s.text ?? ""),
                }))
              : undefined;
            const persistedVoyager = (m.meta as any)?.voyager_action;
            const voyagerAction: VoyagerAction | undefined =
              persistedVoyager && ["contacts", "companies", "deals"].includes(persistedVoyager.resource) &&
              ["POST", "PATCH", "DELETE"].includes(persistedVoyager.method)
                ? {
                    resource: persistedVoyager.resource,
                    method: persistedVoyager.method,
                    id: typeof persistedVoyager.id === "string" ? persistedVoyager.id : undefined,
                    payload: persistedVoyager.payload && typeof persistedVoyager.payload === "object"
                      ? persistedVoyager.payload
                      : undefined,
                    state: typeof persistedVoyager.state === "string" ? persistedVoyager.state : "pending",
                  }
                : undefined;
            const persistedGoogle = (m.meta as any)?.google_action;
            const googleAction: GoogleAction | undefined =
              persistedGoogle &&
              (persistedGoogle.action === "gmail.draft" ||
                persistedGoogle.action === "gmail.send" ||
                persistedGoogle.action === "calendar.create")
                ? {
                    action: persistedGoogle.action,
                    params: (persistedGoogle.params && typeof persistedGoogle.params === "object")
                      ? persistedGoogle.params as Record<string, unknown>
                      : {},
                    state: typeof persistedGoogle.state === "string" ? persistedGoogle.state : "pending",
                  }
                : undefined;
            return {
              id: m.id,
              role: m.role,
              content: parsed.body,
              provider: msgProvider,
              model: msgModel,
              // canvas goes to NotePanel, not to Msg
              ...(hasCanvas ? { hasNote: true } : {}),
              ...(meta ? { meta } : {}),
              ...(persistedSources.length ? { sources: persistedSources } : {}),
              ...(voyagerAction ? { voyagerAction } : {}),
              ...(googleAction ? { googleAction } : {}),
              ...(persistedAgentSteps ? { agentSteps: persistedAgentSteps } : {}),
              ...(persistedThinkingSteps ? { thinking: persistedThinkingSteps, thinkingDone: true } : {}),
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
        });
        setMessages(parsedMsgs);
        if (lastCanvasContent) {
          setNoteContent(lastCanvasContent);
          setNoteTitle(lastCanvasTitle);
        }
      });
    if (conv) {
      setProvider(conv.provider as Provider);
      setModel(conv.model);
    }
  }, [activeId]);

  // Load existing branches (explorations) for this conversation.
  // Only show branches that actually contain at least one message — empty
  // explorations (discarded by the user) are hidden and cleaned up.
  const reloadBranches = async (convId: string) => {
    const { data: rows } = await supabase
      .from("chat_branches")
      .select("id, source_message_id, quoted_text")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    const all = (rows ?? []) as any[];
    if (all.length === 0) { setBranches([]); return; }
    const ids = all.map((b) => b.id);
    const { data: msgs } = await supabase
      .from("branch_messages")
      .select("branch_id, role, content, created_at")
      .in("branch_id", ids)
      .order("created_at", { ascending: true });
    const stats = new Map<string, { count: number; last: string | null }>();
    const firstUser = new Map<string, string>();
    for (const m of (msgs ?? []) as any[]) {
      const cur = stats.get(m.branch_id) ?? { count: 0, last: null };
      // Count assistant replies as "replies"; user prompts also bump activity.
      if (m.role === "assistant") cur.count += 1;
      if (!cur.last || cur.last < m.created_at) cur.last = m.created_at;
      stats.set(m.branch_id, cur);
      if (m.role === "user" && !firstUser.has(m.branch_id)) {
        firstUser.set(m.branch_id, (m.content ?? "").toString());
      }
    }
    setBranches(
      all
        .filter((b) => stats.has(b.id))
        .map((b) => ({
          id: b.id,
          source_message_id: b.source_message_id,
          quoted_text: b.quoted_text ?? "",
          reply_count: stats.get(b.id)?.count ?? 0,
          last_activity: stats.get(b.id)?.last ?? null,
          first_prompt: firstUser.get(b.id) ?? null,
        })),
    );
  };

  useEffect(() => {
    if (!activeId) { setBranches([]); return; }
    void reloadBranches(activeId);
  }, [activeId]);

  // Refresh branch stats whenever the explore panel closes (so reply counts /
  // last-activity timestamps shown in the main view stay up to date).
  useEffect(() => {
    if (exploreOpen) return;
    if (!activeId) return;
    void reloadBranches(activeId);
  }, [exploreOpen, activeId]);

  // ---- Sidebar branches: all explorations across all conversations ----
  type SidebarBranch = {
    id: string;
    conversation_id: string;
    source_message_id: string | null;
    title: string;
  };
  const [sidebarBranches, setSidebarBranches] = useState<SidebarBranch[]>([]);

  const reloadSidebarBranches = async () => {
    const { data: rows } = await supabase
      .from("chat_branches")
      .select("id, conversation_id, source_message_id, quoted_text")
      .order("created_at", { ascending: true });
    const all = (rows ?? []) as any[];
    if (all.length === 0) { setSidebarBranches([]); return; }
    const ids = all.map((b) => b.id);
    const { data: bmsgs } = await supabase
      .from("branch_messages")
      .select("branch_id, role, content, created_at")
      .in("branch_id", ids)
      .order("created_at", { ascending: true });
    const firstUserByBranch = new Map<string, string>();
    const hasMsg = new Set<string>();
    for (const m of (bmsgs ?? []) as any[]) {
      hasMsg.add(m.branch_id);
      if (m.role === "user" && !firstUserByBranch.has(m.branch_id)) {
        firstUserByBranch.set(m.branch_id, (m.content ?? "").toString());
      }
    }
    const cleanTitle = (s: string) =>
      s.replace(/^\/(note|explore)(\s+|$)/i, "").replace(/\s+/g, " ").trim().slice(0, 80) ||
      "Exploration";
    setSidebarBranches(
      all
        .filter((b) => hasMsg.has(b.id) && b.conversation_id)
        .map((b) => ({
          id: b.id,
          conversation_id: b.conversation_id,
          source_message_id: b.source_message_id,
          title: cleanTitle(firstUserByBranch.get(b.id) ?? b.quoted_text ?? ""),
        })),
    );
  };

  useEffect(() => {
    if (!user) { setSidebarBranches([]); return; }
    void reloadSidebarBranches();
  }, [user?.id]);

  // Refresh sidebar branches whenever the explore panel closes.
  useEffect(() => {
    if (exploreOpen) return;
    if (!user) return;
    void reloadSidebarBranches();
  }, [exploreOpen, user?.id]);

  // Group sidebar branches by conversation for the sidebar render.
  const sidebarBranchesByConv: Record<string, { id: string; title: string }[]> = {};
  for (const b of sidebarBranches) {
    (sidebarBranchesByConv[b.conversation_id] ??= []).push({ id: b.id, title: b.title });
  }
  // Pending branch to open once its conversation finishes loading.
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null);

  const handleSidebarOpenBranch = (convId: string, branchId: string) => {
    setPendingBranchId(branchId);
    if (activeId !== convId) {
      setActiveId(convId);
    }
  };

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
    setEphemeral(false);
    setActiveId(null);
    setMessages([]);
  };

  const newEphemeralConversation = () => {
    setEphemeral(true);
    setActiveId(null);
    setMessages([]);
    setClarify(null);
    textareaRef.current?.focus();
  };


  const ensureConversation = async (_firstUserContent: string): Promise<string | null> => {
    if (activeId) return activeId;
    if (!user) return null;
    // Use a placeholder; the AI-generated title will arrive via the SSE "title" event.
    const title = "New conversation";
    const { data, error } = await supabase.from("conversations").insert({
      user_id: user.id, title, provider, model,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Error"); return null; }
    setConversations((prev) => [data as Conversation, ...prev]);
    // Mark BEFORE setActiveId so the load-messages effect sees the flag synchronously
    // and skips the empty DB fetch that would otherwise wipe the optimistic UI.
    freshConvIdsRef.current.add(data.id);
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

    // ---- Free-tier checks ----
    if (isFree) {
      if (plan.remaining <= 0) {
        setUpgradeReason("daily-limit");
        return;
      }
      if (model !== AUTO_MODEL_ID && isPremiumModel(model)) {
        setUpgradeReason("premium-model");
        return;
      }
    }

    // /explore flow: route this request to a side exploration instead of the main chat.
    if (exploreRequested) {
      if (isModeDisabled(aiPrefs, "explore")) {
        toast.error("Explore mode is disabled in your AI preferences");
        setExploreRequested(false);
        return;
      }
      if (!text) {
        toast.info("Type something to explore.");
        return;
      }
      const exploreBlacklist = new Set(aiPrefs?.blacklistedModels ?? []);
      const exploreFavorite = (aiPrefs?.favoriteModels ?? []).find((m) => !exploreBlacklist.has(m));
      const resolved = model === AUTO_MODEL_ID
        ? (exploreFavorite
            ? { provider: providerForModel(exploreFavorite), model: exploreFavorite }
            : routeAuto(text))
        : { provider, model };
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

    // /page flow: ask the AI to return a structured one-pager (JSON), render it
    // in the right-side overlay panel, and show a compact card in the chat.
    if (pageRequested) {
      if (isModeDisabled(aiPrefs, "page")) {
        toast.error("Page mode is disabled in your AI preferences");
        setPageRequested(false);
        return;
      }
      if (!text) {
        toast.info("Type something to generate a page.");
        return;
      }
      // Note: we keep `pageRequested` set so that, if the planner returns
      // clarifying questions, the user's follow-up answer re-enters this branch.
      // We only clear it on the success/error paths of the actual generation.
      setSending(true);
      setClarify(null);
      lastSentRef.current = text;
      lastAttachmentsRef.current = atts;
      if (overrideText === undefined) {
        setInput("");
        setAttachments([]);
      }

      const displayContent = text;
      const attachmentPreviews: MsgAttachmentPreview[] = atts.map((a) =>
        a.kind === "image"
          ? { kind: "image" as const, name: a.name, dataUrl: a.dataUrl }
          : { kind: "file" as const, name: a.name },
      );

      let convId: string | null = null;
      if (!ephemeral && user) {
        convId = await ensureConversation(text);
        if (!convId) { setSending(false); return; }
        // User message persistence runs in the background — saves a round-trip.
        void supabase.from("messages")
          .insert({ conversation_id: convId, user_id: user.id, role: "user", content: displayContent })
          .then(({ error }) => { if (error) console.error("user message insert failed", error); });
      }

      const baseMsgs: Msg[] = [...messages, { id: `eph-${Date.now()}`, role: "user", content: displayContent, attachments: attachmentPreviews.length ? attachmentPreviews : undefined }];
      setMessages([...baseMsgs, { role: "assistant", content: "", provider, model }]);
      setStreaming(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const history = messages
          .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
          .map((m) => ({ role: m.role, content: m.content }));
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-page`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ prompt: text, history, aiPrefs, skipClarify: opts?.skipClarify === true }),
          },
        );
        if (!resp.ok) {
          const t = await resp.text();
          let errMsg = `HTTP ${resp.status}`;
          try { const j = JSON.parse(t); if (j?.error) errMsg = j.error; } catch {}
          throw new Error(errMsg);
        }
        const json = await resp.json() as
          | { type: "clarify"; questions: ClarifyQuestion[]; meta?: RequestMeta }
          | { page: PageSpec; summary: string; meta?: RequestMeta };

        // Planner asked for clarification — drop the assistant placeholder
        // and show the ClarifyCard. Keep `pageRequested` so that the follow-up
        // send re-enters this branch (with skipClarify=true).
        if ("type" in json && json.type === "clarify" && Array.isArray(json.questions) && json.questions.length > 0) {
          setMessages((prev) => {
            if (prev.length && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          setClarify(json.questions);
          setStreaming(false);
          setSending(false);
          return;
        }

        const pageJson = json as { page: PageSpec; summary: string; meta?: RequestMeta };
        const page: PageSpec = { ...pageJson.page, theme: pageJson.page.theme ?? randomPageTheme() };
        const summary = pageJson.summary || "Page generated.";
        // Apply local billing multiplier on top of provider cost.
        const meta: RequestMeta | undefined = pageJson.meta
          ? {
              ...pageJson.meta,
              cost: pageJson.meta.cost
                ? { ...pageJson.meta.cost, multiplier: billingMultiplier(pageJson.meta.model ?? model) }
                : undefined,
            }
          : undefined;
        // Persist as: summary\n\n```page\n{json}\n```
        const persisted = `${summary}\n\n\`\`\`page\n${JSON.stringify(page)}\n\`\`\``;
        let assistantId: string | undefined;
        if (!ephemeral && user && convId) {
          const { data: aData } = await supabase.from("messages").insert({
            conversation_id: convId, user_id: user.id, role: "assistant", content: persisted, model,
            ...(pageJson.meta ? { meta: pageJson.meta } : {}),
          }).select().single();
          assistantId = aData?.id;
        }
        setMessages((prev) => {
          const arr = prev.slice();
          const last = arr[arr.length - 1];
          if (last && last.role === "assistant") {
            arr[arr.length - 1] = { ...last, id: assistantId ?? last.id, content: summary, page, ...(meta ? { meta } : {}) };
          }
          return arr;
        });
        setActivePage(page);
        setPageOpen(true);
        setPageRequested(false);
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Failed to generate page");
        setMessages((prev) => prev.slice(0, -1));
        setPageRequested(false);
      } finally {
        setStreaming(false);
        setSending(false);
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
    const writingMode = !googleService && !voyagerService && (writeRequested || looksLikeWritingRequest(text) || noteContent !== "");
    const previousCanvas = noteContent || null;
    if (writeRequested) setWriteRequested(false);
    // Snapshot reflexion settings for this turn, then reset for the next message.
    const reflexionMode = reflexionRequested;
    const reflexionEffortForTurn = reflexionEffort;
    if (reflexionRequested) setReflexionRequested(false);
    const forceClarify = clarifyRequested;
    if (clarifyRequested) setClarifyRequested(false);

    // Resolve Auto → concrete provider/model for this turn (Auto preference is preserved)
    const userPickedAuto = model === AUTO_MODEL_ID;
    const hasImage = atts.some((a) => a.kind === "image");
    // Pick the first non-blacklisted favorite (user's "default model" in AI Personalization).
    const blacklistSet = new Set(aiPrefs?.blacklistedModels ?? []);
    const favoriteModel = (aiPrefs?.favoriteModels ?? []).find((m) => !blacklistSet.has(m));
    // Force a vision-capable model when images are attached and the user is on Auto.
    // Otherwise, when the user is on Auto, prefer their favorite model over the auto router
    // so that the AI personalization "favorites" act as the real default.
    const resolved = userPickedAuto
      ? (hasImage
          ? { provider: "google" as Provider, model: "gemini-2.5-pro" }
          : favoriteModel
            ? { provider: providerForModel(favoriteModel), model: favoriteModel }
            : routeAuto(text))
      : { provider, model };
    // Apply blacklist fallback: pick the user's first non-blacklisted favorite,
    // or any other allowed model if the resolved one is forbidden.
    const fallbackOrder = ["gemini-3.5-flash", "gpt-5.5", "gpt-5-nano", "gemini-2.5-pro", "claude-sonnet-4-6", "claude-opus-4-7", "mistral-large-latest", "mistral-small-latest"];
    const safeModel = pickAllowedModel(aiPrefs, resolved.model, fallbackOrder);
    const sendProvider = (safeModel === resolved.model ? resolved.provider : providerForModel(safeModel)) as Provider;
    const sendModel = safeModel;
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

    // For existing conversations, convId is known instantly. For new ones we must
    // wait for the INSERT (only this one path actually blocks). All other DB writes
    // (provider/model update + user message persistence) fire in the background
    // and run in parallel with the LLM fetch — saves ~200-400 ms of frontend latency.
    let convId: string | null = null;
    if (!ephemeral && user) {
      convId = await ensureConversation(text || atts[0]?.name || "Attachment");
      if (!convId) { setSending(false); return; }
    }

    const persistedSummary = atts.length
      ? "\n\n" + atts.map((a) =>
          a.kind === "image" ? `📎 Image: ${a.name}` : `📎 File: ${a.name}`
        ).join("\n")
      : "";
    if (!ephemeral && user && convId) {
      // Background updates — DO NOT await. These run in parallel with the LLM call.
      void supabase.from("conversations")
        .update({ provider: convProvider, model: convModel })
        .eq("id", convId)
        .then(({ error }) => { if (error) console.error("conv update failed", error); });
      void supabase.from("messages")
        .insert({
          conversation_id: convId,
          user_id: user.id,
          role: "user",
          content: displayContent + persistedSummary,
        })
        .then(({ error }) => { if (error) console.error("user message insert failed", error); });
    }

    const sentGoogleService = googleService;
    const sentVoyagerService = voyagerService;
    const baseMsgs: Msg[] = [...messages, {
      id: `eph-${Date.now()}`,
      role: "user",
      content: displayContent,
      attachments: attachmentPreviews.length ? attachmentPreviews : undefined,
      googleService: sentGoogleService ?? undefined,
      voyagerService: sentVoyagerService || undefined,
      reflexion: reflexionMode || undefined,
    }];
    setMessages([...baseMsgs, { role: "assistant", content: "", provider: sendProvider, model: sendModel, googleService: sentGoogleService ?? undefined, voyagerService: sentVoyagerService || undefined, reflexion: reflexionMode || undefined }]);
    setStreaming(true);
    if (writingMode) {
      setNoteOpen(true);
      setNoteStreaming(true);
    }
    if (googleService) setGoogleService(null);
    if (voyagerService) setVoyagerService(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setSending(false);
        setStreaming(false);
        toast.error("Please sign in to send messages.");
        return;
      }
      const resp = await fetch(FUNC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          conversationId: convId,
          provider: sendProvider,
          model: sendModel,
          skipClarify: opts?.skipClarify === true,
          writingMode,
          ephemeral,
          // When the user explicitly invoked /write, force the model to produce
          // a canvas — don't let it decide otherwise.
          forceCanvas: writeRequested === true,
          previousCanvas,
          googleService: sentGoogleService,
          voyagerService: sentVoyagerService,
          reflexionMode,
          reflexionEffort: reflexionEffortForTurn,
          forceClarify: forceClarify || undefined,
          aiPrefs: {
            disabledModes: webEnabled
              ? aiPrefs.disabledModes.filter((m) => m !== "web")
              : [...new Set([...aiPrefs.disabledModes, "web"])],
            blacklistedModels: aiPrefs.blacklistedModels,
            favoriteModels: aiPrefs.favoriteModels,
            responseLength: aiPrefs.responseLength,
          },
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
        try {
          const j = JSON.parse(t) as { error?: string };
          if (resp.status === 429 && j.error === "daily_limit") {
            setUpgradeReason("daily-limit");
            void plan.refresh();
            // Remove the assistant placeholder + user msg we just appended.
            setMessages((prev) => prev.slice(0, -2));
            setStreaming(false);
            return;
          }
          if (resp.status === 403 && j.error === "premium_model") {
            setUpgradeReason("premium-model");
            setMessages((prev) => prev.slice(0, -2));
            setStreaming(false);
            return;
          }
        } catch { /* fall through */ }
        throw new Error(t || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";

      // Parse streaming text for writing mode.
      // Strips CANVAS_EDIT/CANVAS_TITLE markers (wherever they appear) and any
      // ```canvas ... ``` fenced block from the body. Returns the extracted
      // canvas content separately so it can stream into the NotePanel instead
      // of rendering as a markdown code block inside the chat bubble.
      const splitCanvas = (raw: string): { body: string; canvas: string | null; title: string | null; editMode: "yes" | "no" | null } => {
        let rest = raw;
        let editMode: "yes" | "no" | null = null;
        let title: string | null = null;

        // CANVAS_EDIT may appear anywhere on its own line — strip it.
        const editMatch = rest.match(/(^|\n)\s*CANVAS_EDIT:\s*(yes|no)\s*(\n|$)/i);
        if (editMatch) {
          editMode = editMatch[2].toLowerCase() as "yes" | "no";
          rest = rest.slice(0, editMatch.index!) + rest.slice(editMatch.index! + editMatch[0].length);
        }
        // CANVAS_TITLE same: strip wherever it appears on its own line.
        const titleMatch = rest.match(/(^|\n)\s*CANVAS_TITLE:\s*([^\n]+?)[ \t]*(\n|$)/i);
        if (titleMatch) {
          title = titleMatch[2].trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 60);
          rest = rest.slice(0, titleMatch.index!) + rest.slice(titleMatch.index! + titleMatch[0].length);
        }

        // Always look for ```canvas fence — strip it from body, return content.
        const open = rest.indexOf("```canvas");
        if (open < 0) {
          // No fence yet; if we already saw CANVAS_EDIT: yes treat canvas as empty (incoming).
          return { body: rest.trimStart(), canvas: editMode === "yes" ? "" : null, title, editMode };
        }
        const afterOpen = rest.indexOf("\n", open);
        if (afterOpen < 0) {
          return { body: rest.slice(0, open).trimStart(), canvas: "", title, editMode };
        }
        const close = rest.indexOf("```", afterOpen + 1);
        if (close < 0) {
          return { body: rest.slice(0, open).trimStart(), canvas: rest.slice(afterOpen + 1), title, editMode };
        }
        const canvas = rest.slice(afterOpen + 1, close).replace(/\n+$/, "");
        const body = (rest.slice(0, open) + rest.slice(close + 3)).trim();
        return { body, canvas, title, editMode };
      };

      // Coalesce delta updates onto a single rAF tick so React renders
      // smoothly (~60fps) instead of once per token.
      let pending = false;
      const flush = () => {
        pending = false;
        const snapshot = acc;
        // Always extract any canvas fence — even outside writingMode — so it
        // never leaks into the chat as a markdown code block.
        const parsed = splitCanvas(snapshot);
        const { body, canvas, title } = parsed;
        if (canvas !== null) {
          if (!noteOpen) setNoteOpen(true);
          if (!noteStreaming) setNoteStreaming(true);
          setNoteContent(canvas);
          if (title) setNoteTitle(title);
        }
        setMessages((prev) => {
          const next = prev.slice();
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: body,
            provider: sendProvider,
            model: sendModel,
            ...(canvas !== null ? { hasNote: true } : {}),
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
              // Detect ```map fenced block to surface a "Map" tool badge
              const openIdx = acc.indexOf("```map");
              if (openIdx !== -1) {
                const afterOpen = acc.slice(openIdx + 6);
                const closeRel = afterOpen.indexOf("```");
                const isClosed = closeRel !== -1;
                const inner = isClosed ? afterOpen.slice(0, closeRel) : afterOpen;
                let label = "";
                const titleMatch = inner.match(/"title"\s*:\s*"([^"]{1,80})"/);
                if (titleMatch) label = titleMatch[1];
                setMessages((prev) => {
                  const next = prev.slice();
                  const cur = next[next.length - 1];
                  const prevTool = cur?.tool;
                  const desiredStatus: ToolStatus = isClosed ? "done" : "running";
                  if (
                    prevTool?.tool === "map" &&
                    prevTool.label === label &&
                    prevTool.status === desiredStatus
                  ) {
                    return prev;
                  }
                  next[next.length - 1] = {
                    ...cur,
                    tool: { tool: "map", label, status: desiredStatus },
                  };
                  return next;
                });
              }
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
            } else if (j.type === "agent_step") {
              const step: AgentStep = {
                index: Number(j.index) || 0,
                kind: j.kind,
                label: String(j.label ?? ""),
                intent: String(j.intent ?? ""),
                status: (j.status as ToolStatus) ?? "running",
                foundCount: typeof j.foundCount === "number" ? j.foundCount : undefined,
                narration: "",
              };
              setMessages((prev) => {
                const next = prev.slice();
                const cur = next[next.length - 1];
                const existing = cur.agentSteps ?? [];
                const idx = existing.findIndex((s) => s.index === step.index);
                let updated: AgentStep[];
                if (idx === -1) {
                  updated = [...existing, step];
                } else {
                  updated = existing.slice();
                  updated[idx] = {
                    ...updated[idx],
                    status: step.status,
                    foundCount: step.foundCount ?? updated[idx].foundCount,
                    label: step.label,
                    intent: step.intent,
                    kind: step.kind,
                  };
                }
                next[next.length - 1] = { ...cur, agentSteps: updated };
                return next;
              });
            } else if (j.type === "agent_narration") {
              const idx = Number(j.index) || 0;
              const text = typeof j.text === "string" ? j.text : "";
              const done = j.done === true;
              setMessages((prev) => {
                const next = prev.slice();
                const cur = next[next.length - 1];
                const existing = cur.agentSteps ?? [];
                const stepIdx = existing.findIndex((s) => s.index === idx);
                if (stepIdx === -1) return prev;
                const updated = existing.slice();
                updated[stepIdx] = {
                  ...updated[stepIdx],
                  narration: updated[stepIdx].narration + text,
                  narrationDone: done ? true : updated[stepIdx].narrationDone,
                };
                next[next.length - 1] = { ...cur, agentSteps: updated };
                return next;
              });
            } else if (j.type === "google_action") {
              const mode = String(j.mode ?? "");
              const actionName = String(j.action ?? "");
              const params = (j.params && typeof j.params === "object") ? j.params as Record<string, unknown> : {};
              const loading = Boolean(j.loading);
              if (mode === "proposal" && (actionName === "gmail.draft" || actionName === "gmail.send" || actionName === "calendar.create")) {
                const ga: GoogleAction = { action: actionName, params, state: "pending", loading };
                setMessages((prev) => {
                  const next = prev.slice();
                  next[next.length - 1] = { ...next[next.length - 1], googleAction: ga };
                  return next;
                });
              } else if (mode === "result") {
                // For read actions, the LLM response will narrate the result.
                // We do not render a card; the existing tool indicator + the streamed
                // text are enough. Still, we could store it if needed later.
              }
            } else if (j.type === "voyager_action") {
              const resource = String(j.resource ?? "") as VoyagerAction["resource"];
              const method = String(j.method ?? "GET") as VoyagerAction["method"];
              const id = typeof j.id === "string" ? j.id : undefined;
              const payload = (j.payload && typeof j.payload === "object") ? j.payload as Record<string, unknown> : undefined;
              if (["contacts", "companies", "deals"].includes(resource) && ["POST", "PATCH", "DELETE"].includes(method)) {
                const va: VoyagerAction = { resource, method, id, payload, state: "pending" };
                setMessages((prev) => {
                  const next = prev.slice();
                  next[next.length - 1] = { ...next[next.length - 1], voyagerAction: va };
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
                  // Attach to the most recent user message (for the legacy badge)
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "user") {
                      next[i] = { ...next[i], memory: mem };
                      break;
                    }
                  }
                  // Also attach to the latest assistant message so the
                  // MemoryInsights dropdown can show the saved counts.
                  for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === "assistant") {
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
            } else if (j.type === "thinking") {
              if (j.action === "step") {
                const step: ThinkingStep = {
                  index: Number(j.index) || 0,
                  text: String(j.text ?? "").trim(),
                };
                if (step.text) {
                  setMessages((prev) => {
                    const next = prev.slice();
                    const cur = next[next.length - 1];
                    const existing = cur.thinking ?? [];
                    next[next.length - 1] = { ...cur, thinking: [...existing, step] };
                    return next;
                  });
                }
              } else if (j.action === "done") {
                const ms = Number(j.durationMs) || 0;
                setMessages((prev) => {
                  const next = prev.slice();
                  const cur = next[next.length - 1];
                  next[next.length - 1] = { ...cur, thinkingMs: ms, thinkingDone: true };
                  return next;
                });
              }
            } else if (j.type === "models_used") {
              const arr = Array.isArray(j.models) ? j.models : [];
              const models: ModelRef[] = arr
                .filter((x: any) => x && typeof x.model === "string" && typeof x.provider === "string")
                .map((x: any) => ({ provider: x.provider as Provider, model: String(x.model) }));
              if (models.length) {
                setMessages((prev) => {
                  const next = prev.slice();
                  next[next.length - 1] = { ...next[next.length - 1], modelsUsed: models };
                  return next;
                });
              }
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
        const parsed = splitCanvas(acc);
        const { body, canvas, title } = parsed;
        if (canvas !== null) {
          if (!noteOpen) setNoteOpen(true);
          setNoteContent(canvas);
          if (title) setNoteTitle(title);
        }
        setMessages((prev) => {
          const next = prev.slice();
          const current = next[next.length - 1];
          next[next.length - 1] = {
            ...current,
            role: "assistant",
            content: body,
            provider: sendProvider,
            model: sendModel,
            ...(canvas !== null ? { hasNote: true } : {}),
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
        // Note: user message was inserted fire-and-forget without awaiting,
        // so we don't have its id to delete here on abort. It stays persisted.

      } else {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setNoteStreaming(false);
      setSending(false);
      if (isFree) void plan.refresh();
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

  // Get caret position relative to the editor container, for menu positioning.
  const getCaretRelativePos = (): { left: number; top: number } => {
    const el = textareaRef.current;
    if (!el) return { left: 0, top: 0 };
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { left: el.offsetLeft, top: el.offsetTop - 8 };
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    const editorRect = el.getBoundingClientRect();
    // Fallback when collapsed range has no rect (empty editor)
    const left = rect.left || editorRect.left;
    return {
      left: el.offsetLeft + (left - editorRect.left),
      top: el.offsetTop - 8,
    };
  };

  const updateSlashFromTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const value = readEditorText(el);
    const caret = getCaretOffsetInText(el);
    const found = detectSlash(value, caret);
    if (!found) {
      setSlash((s) => (s ? null : s));
    } else {
      const pos = getCaretRelativePos();
      setSlash({ query: found.query, start: found.start, pos });
    }
    const mFound = detectMention(value, caret);
    if (!mFound) {
      setMention((m) => (m ? null : m));
    } else {
      const pos = getCaretRelativePos();
      setMention({ query: mFound.query, start: mFound.start, pos });
      setMentionActive(0);
    }
  };

  // ---- @ Mention detection (integrations) ----
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)(@[A-Za-z0-9.\-]*)$/);
    if (!m) return null;
    const token = m[1];
    const start = before.length - token.length;
    return { start, query: token.slice(1).toLowerCase() };
  };

  type MentionItem = {
    key: ChipKind;
    label: string;
    icon: React.ReactNode;
  };
  const ALL_MENTION_ITEMS: MentionItem[] = [
    { key: "gmail", label: GOOGLE_SERVICE_LABEL.gmail, icon: <GoogleServiceLogo service="gmail" className="w-4 h-4" /> },
    { key: "calendar", label: GOOGLE_SERVICE_LABEL.calendar, icon: <GoogleServiceLogo service="calendar" className="w-4 h-4" /> },
    { key: "drive", label: GOOGLE_SERVICE_LABEL.drive, icon: <GoogleServiceLogo service="drive" className="w-4 h-4" /> },
    { key: "voyager", label: VOYAGER_LABEL, icon: <VoyagerLogo className="w-4 h-4" /> },
  ];
  const mentionItems = mention
    ? ALL_MENTION_ITEMS.filter((i) =>
        !mention.query || i.label.toLowerCase().includes(mention.query) || i.key.includes(mention.query),
      )
    : [];

  // Activate an integration: insert an inline chip at the caret and update
  // the integration state. Used by both the @-mention menu and the "+" menu.
  const activateIntegration = (kind: ChipKind, removeLen: number) => {
    const el = textareaRef.current;
    if (!el) return;
    // Only one Google integration allowed at a time — swap chip if needed.
    if (kind === "gmail" || kind === "calendar" || kind === "drive") {
      removeChips(el, ["gmail", "calendar", "drive"]);
      setGoogleService(kind);
    } else {
      setVoyagerService(true);
    }
    el.focus();
    insertChipAtCaret(el, kind, removeLen);
    syncFromEditor();
  };

  const applyMentionSelection = (item: MentionItem) => {
    if (!mention) return;
    const removeLen = mention.query.length + 1; // "@" + query
    setMention(null);
    activateIntegration(item.key, removeLen);
    toast.success(
      item.key === "voyager"
        ? `${VOYAGER_LABEL} enabled for next message`
        : `${GOOGLE_SERVICE_LABEL[item.key]} enabled for next message`,
    );
  };

  const applySlashSelection = (item: SlashItem) => {
    const el = textareaRef.current;
    if (!el || !slash) return;
    // Strip the "/xxx" trigger from the editor by inserting an empty chip-less
    // replacement: easier — rebuild the visible text minus the slice.
    const value = readEditorText(el);
    const caret = getCaretOffsetInText(el);
    const nextText = value.slice(0, slash.start) + value.slice(caret);
    // Preserve chips: rebuild text-only segments; chips remain as DOM.
    // Simpler approach: just replace the trigger text by walking text nodes.
    stripTextRange(el, slash.start, caret);
    setSlash(null);
    if (item.provider === "auto") {
      setModel(AUTO_MODEL_ID);
    } else if (item.provider === "write") {
      if (isModeDisabled(aiPrefs, "note")) { toast.error("Note mode is disabled in your AI preferences"); return; }
      setWriteRequested(true);
      toast.success("Writing canvas enabled for next message");
    } else if (item.provider === "explore") {
      if (isModeDisabled(aiPrefs, "explore")) { toast.error("Explore mode is disabled in your AI preferences"); return; }
      setExploreRequested(true);
    } else if (item.provider === "page") {
      if (isModeDisabled(aiPrefs, "page")) { toast.error("Page mode is disabled in your AI preferences"); return; }
      setPageRequested(true);
      toast.success("Page mode enabled for next message");
    } else if (item.provider === "gmail" || item.provider === "calendar" || item.provider === "drive") {
      activateIntegration(item.provider, 0);
      toast.success(`${GOOGLE_SERVICE_LABEL[item.provider]} enabled for next message`);
    } else if (item.provider === "voyager") {
      activateIntegration("voyager", 0);
      toast.success(`${VOYAGER_LABEL} enabled for next message`);
    } else {
      if (isModelBlacklisted(aiPrefs, item.model)) {
        toast.error("This model is blacklisted in your AI preferences");
        return;
      }
      setProvider(item.provider as Provider);
      setModel(item.model);
    }
    syncFromEditor();
    setTimeout(() => textareaRef.current?.focus(), 0);
    void nextText; // unused now, kept for clarity
  };

  // Walk text nodes, deleting characters in [startOffset, endOffset) of the
  // editor's visible text (chips count as 0 chars).
  const stripTextRange = (root: HTMLElement, startOffset: number, endOffset: number) => {
    let consumed = 0;
    const toRemove: { node: Text; from: number; to: number }[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.hasAttribute && el.hasAttribute("data-chip")) return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        const len = (text.nodeValue || "").length;
        const nodeStart = consumed;
        const nodeEnd = consumed + len;
        const overlapStart = Math.max(startOffset, nodeStart);
        const overlapEnd = Math.min(endOffset, nodeEnd);
        if (overlapEnd > overlapStart) {
          toRemove.push({
            node: text,
            from: overlapStart - nodeStart,
            to: overlapEnd - nodeStart,
          });
        }
        consumed = nodeEnd;
        return;
      }
      node.childNodes.forEach(walk);
    };
    root.childNodes.forEach(walk);
    // Apply in reverse to keep offsets valid
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const { node, from, to } = toRemove[i];
      const v = node.nodeValue || "";
      node.nodeValue = v.slice(0, from) + v.slice(to);
    }
  };

  // After any DOM mutation: re-derive `input` from text and sync integration
  // states from the chips present in the editor.
  const syncFromEditor = () => {
    const el = textareaRef.current;
    if (!el) return;
    const txt = readEditorText(el);
    lastSyncedInputRef.current = txt;
    setInput(txt);
    const chips = listChips(el);
    const g = chips.find((c) => c === "gmail" || c === "calendar" || c === "drive") as
      | GoogleService
      | undefined;
    setGoogleService((prev) => (prev === (g ?? null) ? prev : (g ?? null)));
    const hasVoyager = chips.includes("voyager");
    setVoyagerService((prev) => (prev === hasVoyager ? prev : hasVoyager));
  };


  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the slash menu is open, let it consume navigation/confirm keys
    if (slash && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      return;
    }
    if (mention && mentionItems.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActive((a) => (a + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActive((a) => (a - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMentionSelection(mentionItems[mentionActive]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
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

  // Global keyboard shortcuts:
  // - Cmd/Ctrl + U → open the file picker (overrides browser view-source)
  // - Cmd/Ctrl + O → open the settings dialog (via the open-settings event
  //   that ChatSidebar listens to)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "u") {
        e.preventDefault();
        openFilePicker();
      } else if (key === "o") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("open-settings"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    // Default the explore panel to the same model/provider that produced the
    // associated assistant response — fall back to the nearest assistant
    // message above the source if the source itself is a user message.
    const sourceMsg = messages[sourceIdx];
    const assistantMsg =
      sourceMsg?.role === "assistant"
        ? sourceMsg
        : [...messages.slice(0, sourceIdx + 1)].reverse().find((m) => m.role === "assistant");
    const seedProvider = (assistantMsg?.provider ?? provider) as Provider;
    const seedModel =
      assistantMsg?.model ||
      (model === AUTO_MODEL_ID ? "gpt-5-nano" : model);
    setExploreSeed({
      conversationId: activeId,
      sourceMessageId: payload.messageId,
      quotedText: payload.text,
      parentHistory,
      provider: seedProvider,
      model: seedModel,
    });
    setExploreOpen(true);
  };

  // Reopen an existing branch by id (clicked on a chat indicator tag).
  const openExistingBranch = (branchId: string) => {
    if (!activeId) return;
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    const sourceIdx = branch.source_message_id
      ? messages.findIndex((m) => m.id === branch.source_message_id)
      : -1;
    const parentHistory =
      sourceIdx >= 0
        ? messages
            .slice(0, sourceIdx + 1)
            .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
        : [];
    setExploreSeed({
      conversationId: activeId,
      sourceMessageId: branch.source_message_id ?? "",
      quotedText: branch.quoted_text,
      parentHistory,
      provider,
      model: model === AUTO_MODEL_ID ? "gpt-5-nano" : model,
      existingBranchId: branch.id,
    });
    setExploreOpen(true);
  };

  // Open a pending branch (requested from the sidebar) once the target
  // conversation's branches + messages have finished loading.
  useEffect(() => {
    if (!pendingBranchId || !activeId) return;
    const branch = branches.find((b) => b.id === pendingBranchId);
    if (!branch) return; // wait for branches to load
    if (branch.source_message_id) {
      const ready = messages.some((m) => m.id === branch.source_message_id);
      if (!ready) return; // wait for messages to load
    }
    openExistingBranch(pendingBranchId);
    setPendingBranchId(null);
  }, [pendingBranchId, activeId, branches, messages]);

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
      replyCount: b.reply_count,
      lastActivity: b.last_activity,
      firstPrompt: b.first_prompt,
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  const chatIndexItems = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (m.role !== "user" || !m.id) return false;
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
    }));
  const hasChatIndex = chatIndexItems.length >= 2;

  return (
    <div ref={rootRef} className="flex h-screen w-full bg-background">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setEphemeral(false); setActiveId(id); setSidebarMobileOpen(false); }}
        onNew={() => { newConversation(); setSidebarMobileOpen(false); }}
        onNewEphemeral={() => { newEphemeralConversation(); setSidebarMobileOpen(false); }}
        onDeleted={(id) => {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          if (activeId === id) { setActiveId(null); setMessages([]); }
        }}
        onMoveToFolder={(convId, folderId) => {
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, folder_id: folderId } : c)),
          );
        }}
        userEmail={user?.email}
        userName={displayName ?? (user?.user_metadata?.full_name as string | undefined) ?? user?.email?.split("@")[0]}
        userAvatarUrl={avatarUrl}
        onProfileUpdated={reloadProfile}
        titleAnim={titleAnim}
        branchesByConv={sidebarBranchesByConv}
        activeBranchId={exploreOpen ? exploreSeed?.existingBranchId ?? null : null}
        onOpenBranch={(convId, branchId) => { handleSidebarOpenBranch(convId, branchId); setSidebarMobileOpen(false); }}
        isFree={isFree}
        onLockedFeature={(reason) => setUpgradeReason(reason)}
        mobileOpen={sidebarMobileOpen}
        onMobileOpenChange={setSidebarMobileOpen}
        forceCollapsed={pageOpen}
      />

      <UpgradeDialog
        open={upgradeReason !== null}
        onOpenChange={(o) => { if (!o) setUpgradeReason(null); }}
        reason={upgradeReason ?? "daily-limit"}
      />

      <div
        className="flex-1 flex min-w-0 relative bg-sidebar"
        style={{ transition: "padding-right 300ms ease-in-out", paddingRight: pageOpen ? pageWidth : noteOpen ? noteWidth : 0 }}
      >
      <main
        className="flex-1 flex flex-col min-w-0 relative bg-sidebar"
        style={{ paddingTop: 10, paddingRight: (noteOpen || pageOpen) ? 0 : 10, paddingBottom: 10, paddingLeft: 0, ...(exploreOpen ? { borderTopRightRadius: 15, borderBottomRightRadius: 15, overflow: "hidden" } : {}) }}
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
        {isDragging && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none cursor-copy bg-background/60 backdrop-blur-md transition-opacity duration-200 ease-out opacity-100"
          >
            <div className="flex flex-col items-center gap-3 px-8 py-6 transition-all duration-200 ease-out opacity-100 scale-100">
              <Upload className="w-8 h-8 text-foreground" />
              <div className="text-base font-semibold text-foreground">Drop to add to context</div>
              <div className="text-muted-foreground text-sm">Image, PDF or text — up to 15 MB</div>
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col min-h-0 bg-background rounded-[12px] overflow-hidden">
        <header className="flex items-center gap-2 h-14 md:h-12 px-3 sm:px-4 border-b border-border/50 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarMobileOpen(true)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-[6px] hover:bg-dropdown-hover text-foreground"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6 md:w-4 md:h-4" />
          </button>
          <span className="text-base font-semibold truncate md:text-base">
            {ephemeral
              ? "Ephemeral chat"
              : conversations.find((c) => c.id === activeId)?.title?.trim() || "Chat"}
          </span>
          {ephemeral && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Sparkles className="w-3 h-3" />
              <span className="hidden sm:inline">Not saved · disappears on exit</span>
              <span className="sm:hidden">Not saved</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            
            {!ephemeral && activeId && (() => {
              const conv = conversations.find((c) => c.id === activeId);
              if (!conv) return null;
              return (
                <ConversationActionsMenu
                  conversationId={activeId}
                  currentTitle={conv.title}
                  currentFolderId={conv.folder_id ?? null}
                  onRenamed={(id, title) =>
                    setConversations((prev) =>
                      prev.map((c) => (c.id === id ? { ...c, title } : c)),
                    )
                  }
                  onMoved={(id, folderId) =>
                    setConversations((prev) =>
                      prev.map((c) => (c.id === id ? { ...c, folder_id: folderId } : c)),
                    )
                  }
                  onDeleted={(id) => {
                    setConversations((prev) => prev.filter((c) => c.id !== id));
                    if (activeId === id) {
                      setActiveId(null);
                      setMessages([]);
                    }
                  }}
                />
              );
            })()}
          </div>
        </header>
        <ChatIndex scrollContainer={scrollEl} items={chatIndexItems} />
        <div
          ref={(el) => {
            (scrollRef as any).current = el;
            setScrollEl(el);
          }}
          className="flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 md:px-4">
              {(() => {
                const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
                const fullName =
                  (meta.full_name as string) ||
                  (meta.name as string) ||
                  "";
                const firstName =
                  (meta.given_name as string) ||
                  (fullName ? fullName.trim().split(/\s+/)[0] : "") ||
                  (user?.email ? user.email.split("@")[0] : "");
                return (
                  <h2 className="font-semibold mb-2 text-4xl">
                    {firstName ? `How can I help you, ${firstName}?` : "How can I help you?"}
                  </h2>
                );
              })()}
            </div>
          ) : (
            <div className="pt-8 pb-4 px-6 md:px-10">
              {(() => {
                return messages.map((m, i) => (
                <div key={m.id ?? i}>
                <ChatMessage
                  id={m.id}
                  role={m.role}
                  content={m.content}
                  provider={m.provider}
                  googleService={m.googleService}
                  voyagerService={m.voyagerService}
                  model={m.model}
                  memory={m.memory}
                  tool={m.tool}
                  phase={m.phase}
                  sources={m.sources}
                  meta={m.meta}
                  thinking={m.thinking}
                  thinkingMs={m.thinkingMs}
                  thinkingDone={m.thinkingDone}
                  agentSteps={m.agentSteps}
                  modelsUsed={m.modelsUsed}
                  reflexion={m.reflexion}
                  attachments={m.attachments}
                  page={m.page}
                  onOpenPage={m.page ? () => { setActivePage(m.page!); setPageOpen(true); } : undefined}
                  hasNote={m.hasNote}
                  onOpenNote={m.hasNote ? () => setNoteOpen(true) : undefined}
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
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        range.collapse(false);
                        sel?.removeAllRanges();
                        sel?.addRange(range);
                      }
                    }, 0);
                  } : undefined}
                  googleActionSlot={m.role === "assistant" && (m.googleAction || m.voyagerAction) ? (
                    <div className="mt-2">
                      {m.googleAction && (
                        <GoogleActionCard
                          action={m.googleAction}
                          onChange={(next) => {
                            setMessages((prev) => {
                              const arr = prev.slice();
                              arr[i] = { ...arr[i], googleAction: next };
                              return arr;
                            });
                            // Persist updated draft/state so it survives reloads & tab switches.
                            const mid = m.id;
                            if (mid) {
                              const prevMeta = (m.meta ?? {}) as Record<string, unknown>;
                              const nextMeta = {
                                ...prevMeta,
                                google_action: {
                                  mode: "proposal",
                                  action: next.action,
                                  params: next.params,
                                  state: next.state,
                                },
                              };
                              supabase
                                .from("messages")
                                .update({ meta: nextMeta as any })
                                .eq("id", mid)
                                .then(({ error }) => {
                                  if (error) console.error("persist google_action update failed", error);
                                });
                            }
                          }}
                        />
                      )}
                      {m.voyagerAction && (
                        <VoyagerActionCard
                          action={m.voyagerAction}
                          onChange={(next) => {
                            setMessages((prev) => {
                              const arr = prev.slice();
                              arr[i] = { ...arr[i], voyagerAction: next };
                              return arr;
                            });
                          }}
                        />
                      )}
                    </div>
                  ) : null}
                />
                </div>
              ));
              })()}
            </div>
          )}
        </div>

        <div className={`bg-background ${hasChatIndex ? "pl-[60px] pr-6 md:pr-10" : "px-6 md:px-10"} pb-[5px] pt-[5px] relative`}>
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 -top-20 h-20 bg-gradient-to-t from-background to-transparent"
          />
          <div className="max-w-2xl mx-auto">
            {clarify && (
              <ClarifyCard
                questions={clarify}
                onSkip={() => {
                  setClarify(null);
                  // For page mode, dismissing clarify means "skip questions,
                  // generate anyway" — re-submit the original prompt with
                  // skipClarify=true so the planner goes straight to the plan.
                  if (pageRequested && lastSentRef.current) {
                    void send(lastSentRef.current, lastAttachmentsRef.current ?? [], { skipClarify: true });
                  }
                }}
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
            <div className={`relative bg-card border border-border rounded-[20px] transition-all duration-200 focus-within:shadow-[0_8px_24px_-4px_hsl(0_0%_0%/0.12)] ${mainComposerDimmed ? "opacity-50" : "opacity-100"}`}>
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
                    <div className="flex items-center gap-1.5 text-muted-foreground text-sm px-2 py-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Reading file...
                    </div>
                  )}
                </div>
              )}
              <div className="relative">
                <div
                  ref={textareaRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Message"
                  data-placeholder="Send a message or type / for commands..."
                  contentEditable
                  suppressContentEditableWarning
                  onInput={() => {
                    syncFromEditor();
                    requestAnimationFrame(updateSlashFromTextarea);
                  }}
                  onKeyDown={onKey as unknown as React.KeyboardEventHandler<HTMLDivElement>}
                  onKeyUp={updateSlashFromTextarea}
                  onClick={updateSlashFromTextarea}
                  onFocus={() => notifyComposerFocus("main")}
                  onBlur={() => {
                    notifyComposerBlur("main");
                    setTimeout(() => { setSlash(null); setMention(null); }, 100);
                  }}
                  onPaste={(e) => {
                    // Force plain-text paste — preserves chip semantics.
                    e.preventDefault();
                    const text = e.clipboardData.getData("text/plain");
                    document.execCommand("insertText", false, text);
                  }}
                  className="composer-editor w-full border-0 bg-transparent shadow-none outline-none min-h-[24px] max-h-48 overflow-y-auto py-3.5 px-4 leading-relaxed whitespace-pre-wrap break-words text-base"
                />
              </div>
              {slash && (
                <SlashCommandMenu
                  query={slash.query}
                  position={slash.pos}
                  onSelect={applySlashSelection}
                  onClose={() => setSlash(null)}
                  disabledModes={
                    aiPrefs.disabledModes.filter((m) =>
                      m === "note" || m === "page" || m === "explore",
                    ) as ("note" | "page" | "explore")[]
                  }
                  blacklistedModels={aiPrefs.blacklistedModels}
                  favoriteModels={aiPrefs.favoriteModels}
                />
              )}
              {mention && mentionItems.length > 0 && (
                <div
                  role="listbox"
                  className="absolute z-50 w-56 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                  style={{ left: mention.pos.left, top: mention.pos.top, transform: "translateY(-100%)" }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {mentionItems.map((it, idx) => {
                    const isActive = idx === mentionActive;
                    return (
                      <button
                        key={it.key}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setMentionActive(idx)}
                        onClick={() => applyMentionSelection(it)}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                          isActive ? "bg-dropdown-hover" : ""
                        }`}
                      >
                        <span className="inline-flex items-center justify-center w-4 h-4 shrink-0">
                          {it.icon}
                        </span>
                        <span className="text-[13px] text-foreground truncate">{it.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between gap-[15px] px-2 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="group h-9 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                        aria-label="Add attachment"
                      >
                        <Plus className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:rotate-45" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={openFilePicker}>
                        <Paperclip className="w-4 h-4 mr-2" />
                        <span className="flex-1">Attach files or images</span>
                        <span
                          className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-medium"
                          style={{ background: "#F8F7F5", color: "#888888", borderRadius: "7px" }}
                        >
                          {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘U" : "Ctrl+U"}
                        </span>
                      </DropdownMenuItem>
                      {!aiPrefs.disabledModes.includes("web") && (
                        <DropdownMenuItem
                          onSelect={(e) => e.preventDefault()}
                          className="flex items-center justify-between cursor-default"
                        >
                          <div className="flex items-center">
                            <Globe className="w-4 h-4 mr-2" />
                            Web Search
                          </div>
                          <Switch
                            checked={webEnabled}
                            onCheckedChange={(checked) => {
                              setWebEnabled(checked);
                              try { localStorage.setItem("web-search-enabled", String(checked)); } catch {}
                            }}
                            style={{ transform: "scale(0.8)", transformOrigin: "right center" }}
                          />
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => activateIntegration("gmail", 0)}>
                        <span className="mr-2 inline-flex shrink-0" style={{ border: "1px solid #F8F7F5", borderRadius: "50%", overflow: "hidden" }}>
                          <GoogleServiceLogo service="gmail" className="w-4 h-4" />
                        </span>
                        {GOOGLE_SERVICE_LABEL.gmail}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => activateIntegration("calendar", 0)}>
                        <span className="mr-2 inline-flex shrink-0" style={{ border: "1px solid #F8F7F5", borderRadius: "50%", overflow: "hidden" }}>
                          <GoogleServiceLogo service="calendar" className="w-4 h-4" />
                        </span>
                        {GOOGLE_SERVICE_LABEL.calendar}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => activateIntegration("drive", 0)}>
                        <span className="mr-2 inline-flex shrink-0" style={{ border: "1px solid #F8F7F5", borderRadius: "50%", overflow: "hidden" }}>
                          <GoogleServiceLogo service="drive" className="w-4 h-4" />
                        </span>
                        {GOOGLE_SERVICE_LABEL.drive}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => activateIntegration("voyager", 0)}>
                        <span className="mr-2 inline-flex shrink-0" style={{ border: "1px solid #F8F7F5", borderRadius: "50%", overflow: "hidden" }}>
                          <VoyagerLogo className="w-4 h-4" />
                        </span>
                        {VOYAGER_LABEL}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {!aiPrefs.disabledModes.includes("note") && !writeRequested && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setWriteRequested(true)}
                          aria-label="Activate Note"
                          className="h-9 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M7.66663 3.33331C9.55223 3.33331 10.495 3.33331 11.0808 3.9191C11.6666 4.50489 11.6666 5.44769 11.6666 7.33331C11.6666 12.6666 14.3333 12.6666 14.3333 12.6666H4.82571C4.60707 12.6666 4.49775 12.6666 4.24986 12.6021C4.00197 12.5375 3.96254 12.5155 3.88368 12.4714C3.12363 12.0468 1.66663 10.7828 1.66663 7.33331C1.66663 5.44769 1.66663 4.50489 2.25241 3.9191C2.8382 3.33331 3.78101 3.33331 5.66663 3.33331" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M1.66663 6.66669V10.6667C1.66663 12.5523 1.66663 13.4951 2.25241 14.0809C2.8382 14.6667 3.78101 14.6667 5.66663 14.6667H7.71736C9.60296 14.6667 10.5458 14.6667 11.1316 14.0809C11.4582 13.7543 11.6027 13.3168 11.6666 12.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M7.66663 2.33331V4.33331C7.66663 4.64394 7.66663 4.79925 7.61589 4.92177C7.54823 5.08512 7.41843 5.21491 7.25509 5.28257C7.13256 5.33331 6.97723 5.33331 6.66663 5.33331C6.356 5.33331 6.20069 5.33331 6.07817 5.28257C5.91482 5.21491 5.78503 5.08512 5.71737 4.92177C5.66663 4.79925 5.66663 4.64394 5.66663 4.33331V2.33331C5.66663 2.02269 5.66663 1.86737 5.71737 1.74486C5.78503 1.58151 5.91482 1.45172 6.07817 1.38406C6.20069 1.33331 6.356 1.33331 6.66663 1.33331C6.97723 1.33331 7.13256 1.33331 7.25509 1.38406C7.41843 1.45172 7.54823 1.58151 7.61589 1.74486C7.66663 1.86737 7.66663 2.02269 7.66663 2.33331Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Note</TooltipContent>
                    </Tooltip>
                  )}
                  {!aiPrefs.disabledModes.includes("page") && !pageRequested && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setPageRequested(true)}
                          aria-label="Activate Page"
                          className="h-9 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M2 8C2 5.17157 2 3.75736 2.87868 2.87868C3.75736 2 5.17157 2 8 2C10.8284 2 12.2427 2 13.1213 2.87868C14 3.75736 14 5.17157 14 8C14 10.8284 14 12.2427 13.1213 13.1213C12.2427 14 10.8284 14 8 14C5.17157 14 3.75736 14 2.87868 13.1213C2 12.2427 2 10.8284 2 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M2.33337 5.33331H13.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M8.66663 8H11.3333" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M8.66663 10.6667H9.99996" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6 5.33331V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Page</TooltipContent>
                    </Tooltip>
                  )}
                  {!aiPrefs.disabledModes.includes("reflexion" as ModeId) && !reflexionRequested && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Activate Reflexion"
                          title="Reflexion"
                          className="h-9 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-dropdown-hover"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M8 2C5.79 2 4 3.79 4 6c0 1.27.59 2.4 1.5 3.13V11c0 .55.45 1 1 1h3c.55 0 1-.45 1-1V9.13C11.41 8.4 12 7.27 12 6c0-2.21-1.79-4-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M6.5 13.5h3M7 14.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Reasoning effort</div>
                        <DropdownMenuItem onClick={() => { setReflexionEffort("low"); setReflexionRequested(true); }}>
                          <span className="flex-1">Low</span>
                          <span className="text-xs text-muted-foreground">3 steps</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setReflexionEffort("medium"); setReflexionRequested(true); }}>
                          <span className="flex-1">Medium</span>
                          <span className="text-xs text-muted-foreground">5 steps</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setReflexionEffort("high"); setReflexionRequested(true); }}>
                          <span className="flex-1">High</span>
                          <span className="text-xs text-muted-foreground">8 steps</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  </div>
                  {writeRequested && (
                    <button
                      type="button"
                      onClick={() => setWriteRequested(false)}
                      aria-label="Remove Note"
                      className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium bg-[var(--blue-tag-bg)] transition-colors text-base"
                      style={{ color: "var(--blue-tag-fg)" }}
                    >
                      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "var(--blue-tag-fg)" }}>
                          <path d="M7.66663 3.33331C9.55223 3.33331 10.495 3.33331 11.0808 3.9191C11.6666 4.50489 11.6666 5.44769 11.6666 7.33331C11.6666 12.6666 14.3333 12.6666 14.3333 12.6666H4.82571C4.60707 12.6666 4.49775 12.6666 4.24986 12.6021C4.00197 12.5375 3.96254 12.5155 3.88368 12.4714C3.12363 12.0468 1.66663 10.7828 1.66663 7.33331C1.66663 5.44769 1.66663 4.50489 2.25241 3.9191C2.8382 3.33331 3.78101 3.33331 5.66663 3.33331" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M1.66663 6.66669V10.6667C1.66663 12.5523 1.66663 13.4951 2.25241 14.0809C2.8382 14.6667 3.78101 14.6667 5.66663 14.6667H7.71736C9.60296 14.6667 10.5458 14.6667 11.1316 14.0809C11.4582 13.7543 11.6027 13.3168 11.6666 12.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M7.66663 2.33331V4.33331C7.66663 4.64394 7.66663 4.79925 7.61589 4.92177C7.54823 5.08512 7.41843 5.21491 7.25509 5.28257C7.13256 5.33331 6.97723 5.33331 6.66663 5.33331C6.356 5.33331 6.20069 5.33331 6.07817 5.28257C5.91482 5.21491 5.78503 5.08512 5.71737 4.92177C5.66663 4.79925 5.66663 4.64394 5.66663 4.33331V2.33331C5.66663 2.02269 5.66663 1.86737 5.71737 1.74486C5.78503 1.58151 5.91482 1.45172 6.07817 1.38406C6.20069 1.33331 6.356 1.33331 6.66663 1.33331C6.97723 1.33331 7.13256 1.33331 7.25509 1.38406C7.41843 1.45172 7.54823 1.58151 7.61589 1.74486C7.66663 1.86737 7.66663 2.02269 7.66663 2.33331Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--blue-tag-fg)" }} />
                      </span>
                      Note
                    </button>
                  )}
                  {exploreRequested && (
                    <button
                      type="button"
                      onClick={() => setExploreRequested(false)}
                      aria-label="Remove Explore"
                      className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium bg-[var(--blue-tag-bg)] transition-colors text-base"
                      style={{ color: "var(--blue-tag-fg)" }}
                    >
                      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                        <Sparkles className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "var(--blue-tag-fg)" }} />
                        <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--blue-tag-fg)" }} />
                      </span>
                      Explore
                    </button>
                  )}
                  {pageRequested && (
                    <button
                      type="button"
                      onClick={() => setPageRequested(false)}
                      aria-label="Remove Page"
                      className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-medium bg-[var(--blue-tag-bg)] transition-colors text-base"
                      style={{ color: "var(--blue-tag-fg)" }}
                    >
                      <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "var(--blue-tag-fg)" }}>
                          <path d="M2 8C2 5.17157 2 3.75736 2.87868 2.87868C3.75736 2 5.17157 2 8 2C10.8284 2 12.2427 2 13.1213 2.87868C14 3.75736 14 5.17157 14 8C14 10.8284 14 12.2427 13.1213 13.1213C12.2427 14 10.8284 14 8 14C5.17157 14 3.75736 14 2.87868 13.1213C2 12.2427 2 10.8284 2 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M2.33337 5.33331H13.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8.66663 8H11.3333" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M8.66663 10.6667H9.99996" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M6 5.33331V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--blue-tag-fg)" }} />
                      </span>
                      Page
                    </button>
                  )}
                  {reflexionRequested && (
                    <DropdownMenu>
                      <div
                        className="group inline-flex items-center gap-2 rounded-full pl-3 pr-1 py-1 font-medium bg-[var(--blue-tag-bg)] transition-colors text-base"
                        style={{ color: "var(--blue-tag-fg)" }}
                      >
                        <button
                          type="button"
                          onClick={() => setReflexionRequested(false)}
                          aria-label="Remove Reflexion"
                          className="inline-flex items-center gap-2"
                        >
                          <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-3.5 h-3.5 group-hover:opacity-0 transition-opacity" style={{ color: "var(--blue-tag-fg)" }}>
                              <path d="M8 2C5.79 2 4 3.79 4 6c0 1.27.59 2.4 1.5 3.13V11c0 .55.45 1 1 1h3c.55 0 1-.45 1-1V9.13C11.41 8.4 12 7.27 12 6c0-2.21-1.79-4-4-4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M6.5 13.5h3M7 14.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <X className="w-3.5 h-3.5 absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--blue-tag-fg)" }} />
                          </span>
                          Reflexion
                        </button>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Change effort"
                            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs hover:bg-[color:rgb(0_0_0/0.05)] dark:hover:bg-[color:rgb(255_255_255/0.08)]"
                            style={{ color: "var(--blue-tag-fg)" }}
                          >
                            <span className="capitalize">{reflexionEffort}</span>
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </DropdownMenuTrigger>
                      </div>
                      <DropdownMenuContent align="start" className="w-48">
                        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Reasoning effort</div>
                        <DropdownMenuItem onClick={() => setReflexionEffort("low")}>
                          <span className="flex-1">Low</span>
                          <span className="text-xs text-muted-foreground">3 steps</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setReflexionEffort("medium")}>
                          <span className="flex-1">Medium</span>
                          <span className="text-xs text-muted-foreground">5 steps</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setReflexionEffort("high")}>
                          <span className="flex-1">High</span>
                          <span className="text-xs text-muted-foreground">8 steps</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {/* Integration chips now render inline inside the editor. */}
                </div>
                <div className="flex items-center gap-[15px]">
                  <ModelPicker
                    provider={provider}
                    model={model}
                    onChange={(p, m) => { setProvider(p); setModel(m); }}
                    disabled={streaming}
                    isFree={isFree}
                    onPremiumLocked={() => setUpgradeReason("premium-model")}
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
            <p className="text-muted-foreground text-center mt-[5px] text-xs">
              AI can make mistakes. Always use your own judgment.
            </p>
          </div>
        </div>
        </div>
      </main>

      {/* Floating Explore button over the current selection (self-contained) */}
      {activeId && (
        <SelectionExploreButton onExplore={openExplore} disabled={exploreOpen} />
      )}

      {/* Right-hand exploration side panel */}
      {/* Floating button to reopen the last generated page */}
      {activePage && !pageOpen && (
        <button
          type="button"
          onClick={() => setPageOpen(true)}
          aria-label="Reopen page"
          className="fixed bottom-6 right-6 z-30 w-11 h-11 rounded-full bg-white shadow-md hover:shadow-lg flex items-center justify-center text-foreground transition-shadow"
        >
          <LayoutDashboard className="w-5 h-5" />
        </button>
      )}

      {/* Floating button to reopen the note panel */}
      {noteContent && !noteOpen && (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          aria-label="Reopen note"
          className="fixed bottom-6 right-6 z-30 w-11 h-11 rounded-full bg-white shadow-md hover:shadow-lg flex items-center justify-center text-foreground transition-shadow"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M7.66663 3.33331C9.55223 3.33331 10.495 3.33331 11.0808 3.9191C11.6666 4.50489 11.6666 5.44769 11.6666 7.33331C11.6666 12.6666 14.3333 12.6666 14.3333 12.6666H4.82571C4.60707 12.6666 4.49775 12.6666 4.24986 12.6021C4.00197 12.5375 3.96254 12.5155 3.88368 12.4714C3.12363 12.0468 1.66663 10.7828 1.66663 7.33331C1.66663 5.44769 1.66663 4.50489 2.25241 3.9191C2.8382 3.33331 3.78101 3.33331 5.66663 3.33331" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1.66663 6.66669V10.6667C1.66663 12.5523 1.66663 13.4951 2.25241 14.0809C2.8382 14.6667 3.78101 14.6667 5.66663 14.6667H7.71736C9.60296 14.6667 10.5458 14.6667 11.1316 14.0809C11.4582 13.7543 11.6027 13.3168 11.6666 12.6667" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7.66663 2.33331V4.33331C7.66663 4.64394 7.66663 4.79925 7.61589 4.92177C7.54823 5.08512 7.41843 5.21491 7.25509 5.28257C7.13256 5.33331 6.97723 5.33331 6.66663 5.33331C6.356 5.33331 6.20069 5.33331 6.07817 5.28257C5.91482 5.21491 5.78503 5.08512 5.71737 4.92177C5.66663 4.79925 5.66663 4.64394 5.66663 4.33331V2.33331C5.66663 2.02269 5.66663 1.86737 5.71737 1.74486C5.78503 1.58151 5.91482 1.45172 6.07817 1.38406C6.20069 1.33331 6.356 1.33331 6.66663 1.33331C6.97723 1.33331 7.13256 1.33331 7.25509 1.38406C7.41843 1.45172 7.54823 1.58151 7.61589 1.74486C7.66663 1.86737 7.66663 2.02269 7.66663 2.33331Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Right-hand generated-page side panel */}
      <PagePanel
        open={pageOpen}
        page={activePage}
        onClose={() => setPageOpen(false)}
        onWidthChange={setPageWidth}
      />

      {/* Note side panel */}
      <NotePanel
        open={noteOpen}
        content={noteContent}
        title={noteTitle}
        streaming={noteStreaming}
        onClose={() => setNoteOpen(false)}
        onChange={setNoteContent}
        onTitleChange={setNoteTitle}
        onWidthChange={setNoteWidth}
        onAskChange={(selection, request) => {
          void send(`For the selected text "${selection}": ${request}`);
        }}
      />

      {/* Global lightbox for chat images */}
      <ChatLightbox />

      {user && <ExplorePanel
        open={exploreOpen}
        seed={exploreSeed}
        userId={user.id}
        
        onClose={() => setExploreOpen(false)}
        onMerge={handleMergeSummary}
        onBranchCreated={(b) =>
          setBranches((prev) =>
            prev.some((x) => x.id === b.id)
              ? prev
              : [...prev, { id: b.id, source_message_id: b.source_message_id as any, quoted_text: b.quoted_text, reply_count: 1, last_activity: new Date().toISOString(), first_prompt: null }],
          )
        }
        onBranchDeleted={(id) =>
          setBranches((prev) => prev.filter((x) => x.id !== id))
        }
      />}
      </div>
    </div>
  );
}
