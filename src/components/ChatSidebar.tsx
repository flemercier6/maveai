import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Plus, Trash2, LogOut, Sparkles, Brain } from "lucide-react";
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

  const remove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onDeleted(id);
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
                "group relative w-full rounded-lg text-sm transition-colors",
                activeId === c.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground"
              )}
            >
              <button
                onClick={() => onSelect(c.id)}
                className="w-full flex items-center px-3 py-2 text-left min-w-0"
              >
                <span className="flex-1 truncate pr-6">{c.title}</span>
              </button>
              {(hovered === c.id || activeId === c.id) && (
                <button
                  onClick={(e) => remove(c.id, e)}
                  aria-label="Delete conversation"
                  className={cn(
                    "absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md",
                    "opacity-70 hover:opacity-100 hover:text-destructive hover:bg-background/40",
                    activeId === c.id ? "bg-sidebar-accent" : "bg-sidebar group-hover:bg-sidebar-accent/60"
                  )}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
