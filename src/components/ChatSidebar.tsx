import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Plus, Trash2, Settings, LogOut, Sparkles, KeyRound } from "lucide-react";
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
  onOpenKeys: () => void;
  userEmail?: string;
};

export function ChatSidebar({ conversations, activeId, onSelect, onNew, onDeleted, onOpenKeys, userEmail }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

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
    <aside className="w-72 shrink-0 h-screen flex flex-col bg-sidebar border-r border-sidebar-border">
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sidebar-foreground">Polychat</span>
        </div>
        <Button onClick={onNew} className="w-full mt-2 justify-start gap-2" variant="default">
          <Plus className="w-4 h-4" /> Nouvelle conversation
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-4">Pas encore de conversation.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                activeId === c.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60 text-sidebar-foreground"
              )}
            >
              <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{c.title}</span>
              {(hovered === c.id || activeId === c.id) && (
                <span
                  role="button"
                  onClick={(e) => remove(c.id, e)}
                  className="opacity-60 hover:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        <button
          onClick={onOpenKeys}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-sidebar-accent/60 text-sidebar-foreground"
        >
          <KeyRound className="w-4 h-4 opacity-70" /> Clés API
        </button>
        <div className="px-3 py-2 text-xs text-muted-foreground truncate">{userEmail}</div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-sidebar-accent/60 text-sidebar-foreground"
        >
          <LogOut className="w-4 h-4 opacity-70" /> Se déconnecter
        </button>
      </div>
    </aside>
  );
}
