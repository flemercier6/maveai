import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Upload, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FOLDER_COLORS,
  FOLDER_ICONS,
  getColor,
  getIcon,
  type FolderRow,
} from "@/lib/folders";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When provided, edits an existing folder; otherwise creates a new one. */
  folder?: FolderRow | null;
  /** Called after a successful create/update with the persisted row. */
  onSaved?: (folder: FolderRow) => void;
  /** Called after a successful delete with the deleted folder id. */
  onDeleted?: (folderId: string) => void;
};

export function FolderDialog({ open, onOpenChange, folder, onSaved, onDeleted }: Props) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("slate");
  const [icon, setIcon] = useState<string>("folder");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Reset form whenever the dialog opens (or the target folder changes).
  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? "");
    setColor(folder?.color ?? "slate");
    setIcon(folder?.icon ?? "folder");
    setImageUrl(folder?.image_url ?? null);
    setInstructions(folder?.instructions ?? "");
  }, [open, folder]);

  const PreviewIcon = getIcon(icon);
  const colorDef = getColor(color);

  async function uploadImage(file: File) {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("folder-images")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("folder-images").getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Project name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: trimmed,
        color,
        icon,
        image_url: imageUrl,
        instructions: instructions.trim() || null,
      };
      if (folder) {
        const { data, error } = await supabase
          .from("folders")
          .update(payload)
          .eq("id", folder.id)
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data as FolderRow);
        toast.success("Project updated");
      } else {
        const { data, error } = await supabase
          .from("folders")
          .insert({ ...payload, user_id: user.id })
          .select()
          .single();
        if (error) throw error;
        onSaved?.(data as FolderRow);
        toast.success("Project created");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!folder) return;
    if (!confirm("Delete this project? Its conversations will be moved out.")) return;
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onDeleted?.(folder.id);
    onOpenChange(false);
    toast.success("Project deleted");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" overlayClassName="bg-white/40 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle>{folder ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            Group related chats. Project instructions and memories are used as
            priority context for every chat inside.
          </DialogDescription>
        </DialogHeader>

        {/* Live preview */}
        <div className="flex items-center gap-3 rounded-md border border-border p-3">
          <div
            className={cn(
              "w-10 h-10 rounded-md flex items-center justify-center overflow-hidden shrink-0",
              !imageUrl && colorDef.bg,
            )}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <PreviewIcon className={cn("w-5 h-5", colorDef.fg)} />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{name || "Untitled project"}</div>
            <div className="text-xs text-muted-foreground">Preview</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name" className="text-sm">Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work, Travel, Side project"
              maxLength={60}
            />
          </div>

          {/* Colors */}
          <div className="space-y-1.5">
            <Label className="text-sm">Color</Label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center transition-all",
                    c.bg,
                    color === c.id
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                      : "hover:scale-110",
                  )}
                  aria-label={c.label}
                  title={c.label}
                >
                  {color === c.id && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label className="text-sm">Icon</Label>
            <div className="grid grid-cols-11 gap-1.5">
              {FOLDER_ICONS.map(({ id, label, Icon: I }) => {
                const active = icon === id && !imageUrl;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setIcon(id);
                      setImageUrl(null);
                    }}
                    title={label}
                    className={cn(
                      "h-8 w-8 rounded-md flex items-center justify-center border transition-colors",
                      active
                        ? cn(colorDef.bg, "border-transparent", colorDef.fg)
                        : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <I className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom image */}
          <div className="space-y-1.5">
            <Label className="text-sm">Custom image (optional)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadImage(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {imageUrl ? "Replace" : "Upload"}
              </Button>
              {imageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setImageUrl(null)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </Button>
              )}
              <span className="text-xs text-muted-foreground">PNG, JPG, WEBP up to 5MB</span>
            </div>
          </div>

          {/* Instructions / shared memory */}
          <div className="space-y-1.5">
            <Label htmlFor="folder-instructions" className="text-sm">
              Project context (optional)
            </Label>
            <Textarea
              id="folder-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe the project, the tone, any persistent context… Used as priority memory for all chats in this project."
              rows={4}
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              Memories captured inside this project will also be searched first when chatting here.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {folder && (
            <Button
              type="button"
              variant="ghost"
              onClick={remove}
              className="mr-auto text-destructive hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {folder ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
