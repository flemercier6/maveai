import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Trash2, LogOut, Sparkles, Brain, MoreHorizontal, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type Conversation = {
  id: string;
  title: string;
  provider: string;
  model: string;
  updated_at: string;
};

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
  userEmail?: string;
};

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "chat-sidebar-width";

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onDeleted, userEmail }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const [resizing, setResizing] = useState(false);
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
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sidebar-foreground">Polychat</span>
        </div>
        <Button onClick={onNew} className="w-full mt-2 justify-start gap-2" variant="default">
          <Plus className="w-4 h-4" /> New conversation
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-4">No conversations yet.</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "group relative w-full rounded-[4px] text-sm transition-colors",
                activeId === c.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground"
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
                <button
                  onClick={() => onSelect(c.id)}
                  className="w-full flex items-center text-left min-w-0 px-[4px] text-xs py-[6px]"
                >
                  <span
                    className={cn(
                      "flex-1 truncate transition-[padding] duration-150",
                      hovered === c.id || activeId === c.id || menuOpenId === c.id
                        ? "pr-7"
                        : "pr-1"
                    )}
                  >
                    {c.title}
                  </span>
                </button>
              )}
              {renamingId !== c.id && (hovered === c.id || activeId === c.id || menuOpenId === c.id) && (
                <DropdownMenu
                  open={menuOpenId === c.id}
                  onOpenChange={(o) => setMenuOpenId(o ? c.id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Conversation options"
                      className={cn(
                        "absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-[4px]",
                        "opacity-70 hover:opacity-100 hover:bg-background/40",
                        activeId === c.id ? "bg-sidebar-accent" : "bg-sidebar group-hover:bg-sidebar-accent/60"
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
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        <div className="px-3 py-2 text-xs text-muted-foreground truncate">{userEmail}</div>
        <Link
          to="/memory"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-sidebar-accent/60 text-sidebar-foreground"
        >
          <Brain className="w-4 h-4 opacity-70" /> Memory
        </Link>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-sidebar-accent/60 text-sidebar-foreground"
        >
          <LogOut className="w-4 h-4 opacity-70" /> Sign out
        </button>
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
    </aside>
  );
}
