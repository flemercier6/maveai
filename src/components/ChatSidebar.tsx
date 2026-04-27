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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SettingsDialog } from "@/components/SettingsDialog";
import { FolderDialog } from "@/components/FolderDialog";
import { getColor, getIcon, type FolderRow } from "@/lib/folders";

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
  onDeleted: (id: string) => void;
  /** Called when a conversation is moved to a folder (or null = unfile). */
  onMoveToFolder?: (conversationId: string, folderId: string | null) => void;
  userEmail?: string;
  userName?: string;
  /** Per-conversation streaming title state. target=null while waiting for the AI title. */
  titleAnim?: Record<string, { target: string | null; shown: string }>;
  /** Explorations grouped by conversation id, displayed as collapsible sub-items. */
  branchesByConv?: Record<string, { id: string; title: string }[]>;
  /** Currently open branch id (when the explore panel is open). */
  activeBranchId?: string | null;
  /** Open the given branch in the explore panel (switches conversation if needed). */
  onOpenBranch?: (conversationId: string, branchId: string) => void;
};

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "chat-sidebar-width";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onDeleted, onMoveToFolder, userEmail, userName, titleAnim, branchesByConv, activeBranchId, onOpenBranch }: Props) {
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
    window.location.href = "/signin";
  };

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="relative shrink-0 h-screen flex flex-col bg-sidebar border-r border-sidebar-border"
    >
      <div className="p-3 border-b border-sidebar-border">
        <div className="mt-2 space-y-0.5">
          <button
            onClick={onNew}
            className="group w-full flex items-center gap-2 px-[10px] py-[6px] rounded-[4px] text-sidebar-foreground hover:bg-sidebar-accent text-sm"
          >
            <Plus className="w-4 h-4 opacity-70" />
            <span>New chat</span>
            <kbd
              aria-label="Keyboard shortcut"
              className="ml-auto inline-flex items-center gap-0.5 rounded-[3px] border border-sidebar-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity"
            >
              {isMac ? "⌘" : "Ctrl"}
              <span>N</span>
            </kbd>
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-[10px] py-[6px] rounded-[4px] text-sidebar-foreground hover:bg-sidebar-accent text-sm"
          >
            <Search className="w-4 h-4 opacity-70" /> Search chats
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="group flex w-full items-center gap-1 px-[10px] py-[6px] text-[11px] font-medium text-muted-foreground hover:text-sidebar-foreground">
              <ChevronDown className="w-3 h-3 transition-transform group-data-[state=closed]:-rotate-90" />
              <span>Recent</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 pt-1">
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">No conversations yet.</p>
              )}
              {conversations.map((c) => {
                const convBranches = branchesByConv?.[c.id] ?? [];
                const hasBranches = convBranches.length > 0;
                const expanded = hasBranches && isConvExpanded(c.id);
                return (
                <div key={c.id}>
                <div
                  onMouseEnter={() => setHovered(c.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={cn(
                    "group relative w-full rounded-[4px] text-sm transition-colors",
                    activeId === c.id
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent text-sidebar-foreground"
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
                    <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 pr-1">
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
                        className="min-w-0 overflow-hidden text-left text-xs pr-[4px] py-[5px]"
                      >
                        {(() => {
                          const anim = titleAnim?.[c.id];
                          // Waiting for the AI-generated title -> shimmer placeholder
                          if (anim && anim.target === null) {
                            return (
                              <span
                                className="block h-3.5 w-2/3 rounded-[3px] bg-gradient-to-r from-[hsl(var(--muted))] via-[hsl(var(--border))] to-[hsl(var(--muted))] bg-[length:200%_100%] animate-title-shimmer"
                                aria-label="Generating title…"
                              />
                            );
                          }
                          // Streaming the AI title char by char
                          if (anim && anim.target) {
                            const done = anim.shown.length >= anim.target.length;
                            return (
                              <span
                                className={cn(
                                  "block truncate text-sm bg-clip-text",
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
                            <span className="block truncate text-sm">{c.title}</span>
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
                        <DropdownMenuContent align="start" side="right" className="w-36">
                          <DropdownMenuItem onClick={() => startRename(c)}>
                            <Pencil className="w-3.5 h-3.5 mr-2 opacity-70" /> Rename
                          </DropdownMenuItem>
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
              })}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <div className="w-7 h-7 shrink-0 rounded-full bg-sidebar-accent text-sidebar-accent-foreground flex items-center justify-center text-xs font-medium uppercase">
                {(userName?.[0] ?? userEmail?.[0] ?? "?")}
              </div>
              <span className="flex-1 min-w-0 text-left text-xs truncate">
                {userName ?? userEmail?.split("@")[0] ?? "User"}
              </span>
              <ChevronsUpDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
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
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        onDoubleClick={() => { setWidth(DEFAULT_WIDTH); localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH)); }}
        className={cn(
          "absolute top-0 right-0 h-full w-1 cursor-col-resize group z-10",
          "hover:bg-primary/40 transition-colors",
          resizing && "bg-primary/60"
        )}
        title="Drag to resize — double-click to reset"
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
}
