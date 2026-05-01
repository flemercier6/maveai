import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Trash2,
  LogOut,
  Sparkles,
  MoreHorizontal,
  Pencil,
  ChevronDown,
  Search,
  Settings,
  ChevronsUpDown,
  FolderPlus,
  Folder as FolderIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MessageSquareDashedIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SearchChatsDialog } from "@/components/SearchChatsDialog";
import { FolderDialog } from "@/components/FolderDialog";
import { getColor, getIcon, type FolderRow } from "@/lib/folders";
import { usePlan } from "@/hooks/usePlan";
import maveLogo from "@/assets/mave_logo.svg";

export type Conversation = {
  id: string;
  title: string;
  provider: string;
  model: string;
  updated_at: string;
  folder_id?: string | null;
};

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Start a one-shot chat that is never saved or shown in the sidebar. */
  onNewEphemeral?: () => void;
  onDeleted: (id: string) => void;
  /** Called when a conversation is moved to a folder (or null = unfile). */
  onMoveToFolder?: (conversationId: string, folderId: string | null) => void;
  userEmail?: string;
  userName?: string;
  userAvatarUrl?: string | null;
  /** Called when the user updates their profile from the settings dialog. */
  onProfileUpdated?: () => void;
  /** Per-conversation streaming title state. target=null while waiting for the AI title. */
  titleAnim?: Record<string, { target: string | null; shown: string }>;
  /** Explorations grouped by conversation id, displayed as collapsible sub-items. */
  branchesByConv?: Record<string, { id: string; title: string }[]>;
  /** Currently open branch id (when the explore panel is open). */
  activeBranchId?: string | null;
  /** Open the given branch in the explore panel (switches conversation if needed). */
  onOpenBranch?: (conversationId: string, branchId: string) => void;
  /** True when the user is on the free plan — disables Plus-only features. */
  isFree?: boolean;
  /** Called when a free user tries to use a Plus-only feature. */
  onLockedFeature?: (reason: "save-chat" | "folder") => void;
  /** Mobile drawer open state (controlled). On desktop the sidebar is always visible. */
  mobileOpen?: boolean;
  /** Called when the mobile drawer should open/close (e.g. backdrop tap, item select). */
  onMobileOpenChange?: (open: boolean) => void;
};

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "chat-sidebar-width";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onNewEphemeral, onDeleted, onMoveToFolder, userEmail, userName, userAvatarUrl, onProfileUpdated, titleAnim, branchesByConv, activeBranchId, onOpenBranch, isFree, onLockedFeature, mobileOpen = false, onMobileOpenChange }: Props) {
  const { plan } = usePlan();
  const planLabel = plan === "free" ? "Free" : plan === "plus" ? "Plus" : plan.charAt(0).toUpperCase() + plan.slice(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const [expandedConvs, setExpandedConvs] = useState<Record<string, boolean>>({});
  const isConvExpanded = (id: string) => {
    if (id in expandedConvs) return expandedConvs[id];
    // Default: expand the active conversation that has branches.
    return activeId === id;
  };
  const toggleConv = (id: string) =>
    setExpandedConvs((prev) => ({ ...prev, [id]: !isConvExpanded(id) }));
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    "preferences" | "integrations" | "memory" | "usage" | "billing" | undefined
  >(undefined);

  // Listen for a global request to open the settings dialog on a specific
  // section (e.g. the "Upgrade to Plus" CTA in UpgradeDialog routes to the
  // billing tab).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ section?: typeof settingsInitialSection }>).detail;
      setSettingsInitialSection(detail?.section);
      setSettingsOpen(true);
    };
    window.addEventListener("open-settings", handler as EventListener);
    return () => window.removeEventListener("open-settings", handler as EventListener);
  }, []);

  // Folders state ------------------------------------------------------------
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderRow | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [dragConvId, setDragConvId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | "unfiled" | null>(null);

  const isFolderExpanded = (id: string) => expandedFolders[id] ?? true;
  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => ({ ...prev, [id]: !isFolderExpanded(id) }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("folders")
        .select("*")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setFolders((data ?? []) as FolderRow[]);
      setFoldersLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Group conversations by folder.
  const { byFolder, unfiled } = useMemo(() => {
    const m = new Map<string, Conversation[]>();
    const u: Conversation[] = [];
    for (const c of conversations) {
      if (c.folder_id) {
        const arr = m.get(c.folder_id) ?? [];
        arr.push(c);
        m.set(c.folder_id, arr);
      } else {
        u.push(c);
      }
    }
    return { byFolder: m, unfiled: u };
  }, [conversations]);

  async function moveConvToFolder(convId: string, folderId: string | null) {
    const { error } = await supabase
      .from("conversations")
      .update({ folder_id: folderId })
      .eq("id", convId);
    if (error) {
      toast.error(error.message);
      return;
    }
    onMoveToFolder?.(convId, folderId);
  }

  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const left = asideRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left));
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      localStorage.setItem(STORAGE_KEY, String(width));
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, width]);

  const remove = async (id: string) => {
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onDeleted(id);
  };

  const startRename = (c: Conversation) => {
    setRenamingId(c.id);
    setRenameValue(c.title);
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    const { error } = await supabase
      .from("conversations")
      .update({ title })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Optimistic update via parent: mutate local list by reloading
    const target = conversations.find((c) => c.id === id);
    if (target) target.title = title;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <>
      {/* Mobile backdrop — only mounted when open */}
      {mobileOpen && (
        <div
          onClick={() => onMobileOpenChange?.(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          aria-hidden="true"
        />
      )}
      <aside
        ref={asideRef}
        style={{ ['--sidebar-w' as any]: `${width}px` }}
        className={cn(
          "shrink-0 h-screen flex flex-col bg-sidebar border-r border-sidebar-border",
          // Mobile: fixed drawer overlay full width; Desktop: in-flow with custom width
          "fixed top-0 left-0 z-50 w-screen max-w-full transition-transform duration-200 ease-out text-[15px]",
          "md:relative md:w-[var(--sidebar-w)] md:max-w-none md:translate-x-0 md:transition-none md:text-sm",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
      <div className="p-3 border-b border-sidebar-border">
        <div className="px-[10px] pt-1" style={{ marginBottom: 40 }}>
          <img src={maveLogo} alt="Mave" className="h-4 w-auto" />
        </div>
        <div className="mt-2 space-y-0.5">
          <div className="group flex items-stretch w-full">
            <button
              onClick={() => {
                if (isFree) { onLockedFeature?.("save-chat"); return; }
                onNew();
              }}
              className="flex-1 flex items-center gap-3 md:gap-2 px-3 md:px-[10px] py-[10px] md:py-[6px] rounded-[6px] md:rounded-[4px] text-sidebar-foreground hover:bg-sidebar-accent text-[15px] md:text-sm"
            >
              <Plus className="w-5 h-5 md:w-4 md:h-4 opacity-70" />
              <span>New chat</span>
              {isFree && (
                <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider rounded-full bg-foreground/10 text-foreground/60 px-1.5 py-0.5">
                  Plus
                </span>
              )}
            </button>
            {onNewEphemeral && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onNewEphemeral}
                    aria-label="New ephemeral chat"
                    className="ml-1 self-stretch aspect-square flex items-center justify-center rounded-[6px] md:rounded-[4px] text-sidebar-foreground hover:bg-sidebar-accent"
                  >
                    <HugeiconsIcon icon={MessageSquareDashedIcon} className="w-5 h-5 md:w-4 md:h-4 opacity-70" strokeWidth={2} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ephemeral chat (not saved)</TooltipContent>
              </Tooltip>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-3 md:gap-2 px-3 md:px-[10px] py-[10px] md:py-[6px] rounded-[6px] text-sidebar-foreground hover:bg-sidebar-accent text-[15px] md:text-sm md:rounded-md"
          >
            <Search className="w-5 h-5 md:w-4 md:h-4 opacity-70" /> Search chats
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {(() => {
            // Inline renderer for one conversation row (used in folders & Recent)
            const renderConv = (c: Conversation) => {
              const convBranches = branchesByConv?.[c.id] ?? [];
              const hasBranches = convBranches.length > 0;
              const expanded = hasBranches && isConvExpanded(c.id);
              return (
                <div key={c.id}>
                  <div
                    draggable={renamingId !== c.id}
                    onDragStart={(e) => {
                      setDragConvId(c.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.id);
                    }}
                    onDragEnd={() => {
                      setDragConvId(null);
                      setDragOverFolderId(null);
                    }}
                    onMouseEnter={() => setHovered(c.id)}
                    onMouseLeave={() => setHovered(null)}
                    className={cn(
                      "group relative w-full rounded-[6px] md:rounded-md text-sm transition-colors",
                      activeId === c.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent text-sidebar-foreground",
                      dragConvId === c.id && "opacity-50",
                    )}
                  >
                    {renamingId === c.id ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(c.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7 text-xs px-1.5 py-0 rounded-[4px]"
                      />
                    ) : (
                      <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 pr-2 rounded-md">
                        {hasBranches ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleConv(c.id); }}
                            aria-label={expanded ? "Collapse explorations" : "Expand explorations"}
                            className="flex h-6 w-5 items-center justify-center rounded-[3px] text-muted-foreground hover:text-sidebar-foreground"
                          >
                            <ChevronDown
                              className={cn(
                                "w-3 h-3 transition-transform",
                                !expanded && "-rotate-90",
                              )}
                            />
                          </button>
                        ) : (
                          <span className="w-5" />
                        )}
                        <button
                          onClick={() => onSelect(c.id)}
                          className="min-w-0 overflow-hidden text-left text-xs pr-[4px] py-[10px] md:py-[5px]"
                        >
                          {(() => {
                            const anim = titleAnim?.[c.id];
                            if (anim && anim.target === null) {
                              return (
                                <span
                                  className="block h-3.5 w-2/3 rounded-[3px] bg-gradient-to-r from-[hsl(var(--muted))] via-[hsl(var(--border))] to-[hsl(var(--muted))] bg-[length:200%_100%] animate-title-shimmer"
                                  aria-label="Generating title…"
                                />
                              );
                            }
                            if (anim && anim.target) {
                              const done = anim.shown.length >= anim.target.length;
                              return (
                                <span
                                  className={cn(
                                    "block truncate text-[15px] md:text-sm bg-clip-text",
                                    !done &&
                                      "text-transparent bg-gradient-to-r from-foreground via-muted-foreground to-foreground bg-[length:200%_100%] animate-title-shimmer",
                                  )}
                                >
                                  {anim.shown}
                                  {!done && (
                                    <span className="ml-0.5 inline-block w-[1px] h-3 align-middle bg-foreground/60 animate-pulse" />
                                  )}
                                </span>
                              );
                            }
                            return (
                              <span className="block truncate text-[15px] md:text-sm">{c.title}</span>
                            );
                          })()}
                        </button>
                        <DropdownMenu
                          open={menuOpenId === c.id}
                          onOpenChange={(o) => setMenuOpenId(o ? c.id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Conversation options"
                              className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] transition-opacity hover:bg-background/40",
                                activeId === c.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
                                hovered === c.id || menuOpenId === c.id
                                  ? "opacity-70 hover:opacity-100"
                                  : "opacity-0 pointer-events-none"
                              )}
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="right" className="w-44">
                            <DropdownMenuItem onClick={() => startRename(c)}>
                              <Pencil className="w-3.5 h-3.5 mr-2 opacity-70" /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <FolderIcon className="w-3.5 h-3.5 mr-2 opacity-70" /> Move to project
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-48 max-h-64 overflow-auto">
                                {folders.length === 0 && (
                                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                    No folders yet
                                  </div>
                                )}
                                {folders.map((f) => {
                                  const FIcon = getIcon(f.icon);
                                  const col = getColor(f.color);
                                  return (
                                    <DropdownMenuItem
                                      key={f.id}
                                      onClick={() => moveConvToFolder(c.id, f.id)}
                                      disabled={c.folder_id === f.id}
                                    >
                                      <span
                                        className={cn(
                                          "w-4 h-4 rounded mr-2 flex items-center justify-center overflow-hidden",
                                          !f.image_url && col.bg,
                                        )}
                                      >
                                        {f.image_url ? (
                                          <img src={f.image_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                          <FIcon className={cn("w-2.5 h-2.5", col.fg)} />
                                        )}
                                      </span>
                                      <span className="truncate">{f.name}</span>
                                    </DropdownMenuItem>
                                  );
                                })}
                                {c.folder_id && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => moveConvToFolder(c.id, null)}>
                                      Remove from project
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => remove(c.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                  {hasBranches && expanded && (
                    <div className="ml-[18px] mt-0.5 mb-0.5 pl-2 border-l border-sidebar-border space-y-0.5">
                      {convBranches.map((b) => {
                        const isActive = activeBranchId === b.id;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => onOpenBranch?.(c.id, b.id)}
                            className={cn(
                              "group/branch flex w-full items-center gap-1.5 rounded-[4px] px-[8px] py-[4px] text-left text-xs transition-colors",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                            )}
                            title={b.title}
                          >
                            <Sparkles className="w-3 h-3 shrink-0 opacity-70" />
                            <span className="truncate">{b.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                {/* ============== FOLDERS ============== */}
                <Collapsible defaultOpen>
                  <div className="flex items-center justify-between pr-1">
                    <CollapsibleTrigger className="group flex items-center gap-1 px-[10px] py-[6px] text-sm font-medium text-muted-foreground hover:text-sidebar-foreground">
                      <ChevronDown className="w-3 h-3 transition-transform group-data-[state=closed]:-rotate-90" />
                      <span>Projects</span>
                    </CollapsibleTrigger>
                    <button
                      type="button"
                      onClick={() => {
                        if (isFree) { onLockedFeature?.("folder"); return; }
                        setEditingFolder(null);
                        setFolderDialogOpen(true);
                      }}
                      title={isFree ? "Projects are a Plus feature" : "New project"}
                      className="h-6 w-6 flex items-center justify-center rounded-[4px] text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <CollapsibleContent className="space-y-0.5 pt-1">
                    {foldersLoaded && folders.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">
                        Create a project to group related chats.
                      </p>
                    )}
                    {folders.map((f) => {
                      const FIcon = getIcon(f.icon);
                      const col = getColor(f.color);
                      const items = byFolder.get(f.id) ?? [];
                      const expanded = isFolderExpanded(f.id);
                      const isDropTarget = dragOverFolderId === f.id;
                      return (
                        <div
                          key={f.id}
                          onDragOver={(e) => {
                            if (!dragConvId) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverFolderId(f.id);
                          }}
                          onDragLeave={() => {
                            if (dragOverFolderId === f.id) setDragOverFolderId(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = dragConvId ?? e.dataTransfer.getData("text/plain");
                            if (id) void moveConvToFolder(id, f.id);
                            setDragConvId(null);
                            setDragOverFolderId(null);
                          }}
                          className={cn(
                            "rounded-[4px] transition-colors",
                            isDropTarget && cn(col.soft, "ring-1 ring-inset", "ring-foreground/20"),
                          )}
                        >
                          <div
                            className={cn(
                              "group flex items-center gap-1.5 md:gap-1 px-[8px] md:px-[6px] py-[8px] md:py-[4px] rounded-[6px] md:rounded-[4px] hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer",
                            )}
                            onClick={() => toggleFolder(f.id)}
                          >
                            <ChevronDown
                              className={cn(
                                "w-3 h-3 text-muted-foreground transition-transform",
                                !expanded && "-rotate-90",
                              )}
                            />
                            <span
                              className={cn(
                                "w-5 h-5 rounded flex items-center justify-center overflow-hidden shrink-0",
                                !f.image_url && col.bg,
                              )}
                            >
                              {f.image_url ? (
                                <img src={f.image_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <FIcon className={cn("w-3 h-3", col.fg)} />
                              )}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-[14px] md:text-sm font-bold">{f.name}</span>
                            <span className="text-[10px] tabular-nums text-muted-foreground/70">
                              {items.length || ""}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingFolder(f);
                                setFolderDialogOpen(true);
                              }}
                              aria-label="Edit project"
                              className="opacity-0 group-hover:opacity-70 hover:opacity-100 transition-opacity h-5 w-5 flex items-center justify-center rounded-[3px] hover:bg-background/40"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                          {expanded && (
                            <div className="ml-[14px] pl-2 border-l border-sidebar-border space-y-0.5 py-0.5">
                              {items.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground/70 px-2 py-1">
                                  Drop a chat here
                                </p>
                              ) : (
                                items.map(renderConv)
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>

                {/* ============== RECENT (unfiled) ============== */}
                <Collapsible defaultOpen>
                  <CollapsibleTrigger
                    className="group flex w-full items-center gap-1 px-[10px] py-[6px] text-[11px] font-medium text-muted-foreground hover:text-sidebar-foreground"
                  >
                    <ChevronDown className="w-3 h-3 transition-transform group-data-[state=closed]:-rotate-90" />
                    <span>Recent</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent
                    className={cn(
                      "space-y-0.5 pt-1 rounded-[4px] transition-colors",
                      dragOverFolderId === "unfiled" && "bg-sidebar-accent/40 ring-1 ring-inset ring-foreground/10",
                    )}
                    onDragOver={(e) => {
                      if (!dragConvId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverFolderId("unfiled");
                    }}
                    onDragLeave={() => {
                      if (dragOverFolderId === "unfiled") setDragOverFolderId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = dragConvId ?? e.dataTransfer.getData("text/plain");
                      if (id) void moveConvToFolder(id, null);
                      setDragConvId(null);
                      setDragOverFolderId(null);
                    }}
                  >
                    {unfiled.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">
                        {conversations.length === 0
                          ? "No conversations yet."
                          : "All chats are in projects."}
                      </p>
                    )}
                    {unfiled.map(renderConv)}
                  </CollapsibleContent>
                </Collapsible>
              </>
            );
          })()}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-sidebar-border">
        {userEmail ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center gap-3 md:gap-2 px-2 py-2.5 md:py-1.5 rounded-[6px] md:rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
              >
                <div className="w-9 h-9 md:w-7 md:h-7 shrink-0 rounded-full bg-sidebar-accent text-sidebar-accent-foreground flex items-center justify-center text-sm md:text-xs font-medium uppercase overflow-hidden">
                  {userAvatarUrl ? (
                    <img src={userAvatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (userName?.[0] ?? userEmail?.[0] ?? "?")
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[14px] md:text-xs font-semibold truncate">
                    {userName ?? userEmail?.split("@")[0] ?? "User"}
                  </div>
                  <div className="text-[11px] md:text-[10px] text-muted-foreground truncate leading-tight">
                    {planLabel}
                  </div>
                </div>
                <ChevronsUpDown className="w-4 h-4 md:w-3.5 md:h-3.5 opacity-60 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-[--radix-dropdown-menu-trigger-width]">
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSettingsOpen(true); }}>
                <Settings className="w-3.5 h-3.5 mr-2 opacity-70" /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="w-3.5 h-3.5 mr-2 opacity-70" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("open-auth-popover"))}
            className="w-full px-3 py-2.5 md:py-2 rounded-[6px] md:rounded-md bg-sidebar text-sidebar-foreground text-sm font-semibold hover:bg-sidebar-accent transition-colors text-left"
          >
            Sign in / Create account
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        onDoubleClick={() => { setWidth(DEFAULT_WIDTH); localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH)); }}
        className={cn(
          "hidden md:block absolute top-0 right-0 h-full w-1 cursor-col-resize group z-10",
          "hover:bg-primary/40 transition-colors",
          resizing && "bg-primary/60"
        )}
        title="Drag to resize — double-click to reset"
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(o) => { setSettingsOpen(o); if (!o) setSettingsInitialSection(undefined); }}
        initialSection={settingsInitialSection}
        onProfileUpdated={onProfileUpdated}
      />
      <SearchChatsDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        conversations={conversations}
        onSelect={onSelect}
      />
      <FolderDialog
        open={folderDialogOpen}
        onOpenChange={(o) => { setFolderDialogOpen(o); if (!o) setEditingFolder(null); }}
        folder={editingFolder}
        onSaved={(f) =>
          setFolders((prev) => {
            const idx = prev.findIndex((p) => p.id === f.id);
            if (idx === -1) return [...prev, f];
            const copy = prev.slice();
            copy[idx] = f;
            return copy;
          })
        }
        onDeleted={(id) => setFolders((prev) => prev.filter((p) => p.id !== id))}
      />
    </aside>
    </>
  );
}
