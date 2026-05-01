// "..." menu next to the Share button in a chat header.
// Provides: Rename, Move to Project (folder), Delete.
import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Folder as FolderIcon, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getColor, getIcon, type FolderRow } from "@/lib/folders";
import { cn } from "@/lib/utils";

type Props = {
  conversationId: string;
  currentTitle: string;
  currentFolderId: string | null;
  onRenamed?: (id: string, title: string) => void;
  onMoved?: (id: string, folderId: string | null) => void;
  onDeleted?: (id: string) => void;
};

export function ConversationActionsMenu({
  conversationId,
  currentTitle,
  currentFolderId,
  onRenamed,
  onMoved,
  onDeleted,
}: Props) {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTitle);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("folders")
        .select("*")
        .order("position", { ascending: true });
      if (!cancelled && data) setFolders(data as FolderRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRename = () => {
    setRenameValue(currentTitle);
    setRenameOpen(true);
  };

  const commitRename = async () => {
    const title = renameValue.trim();
    if (!title || title === currentTitle) {
      setRenameOpen(false);
      return;
    }
    const { error } = await supabase
      .from("conversations")
      .update({ title })
      .eq("id", conversationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRenameOpen(false);
    onRenamed?.(conversationId, title);
  };

  const move = async (folderId: string | null) => {
    const { error } = await supabase
      .from("conversations")
      .update({ folder_id: folderId })
      .eq("id", conversationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    onMoved?.(conversationId, folderId);
  };

  const remove = async () => {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversationId);
    if (error) {
      toast.error(error.message);
      return;
    }
    onDeleted?.(conversationId);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={openRename}>
            <Pencil className="w-3.5 h-3.5 mr-2 opacity-70" /> Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderIcon className="w-3.5 h-3.5 mr-2 opacity-70" /> Move to Project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 max-h-64 overflow-auto">
              {folders.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No projects yet
                </div>
              )}
              {folders.map((f) => {
                const FIcon = getIcon(f.icon);
                const col = getColor(f.color);
                return (
                  <DropdownMenuItem
                    key={f.id}
                    onClick={() => move(f.id)}
                    disabled={currentFolderId === f.id}
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
              {currentFolderId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => move(null)}>
                    Remove from project
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={remove}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={commitRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
