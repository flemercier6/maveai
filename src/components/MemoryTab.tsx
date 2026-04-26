import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Upload, Sparkles, Check, X, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { extractKeywords } from "@/lib/keywords";

type Memory = {
  id: string;
  content: string;
  kind: string;
  created_at: string;
  consolidated_at: string | null;
  source_count: number;
};

export function MemoryTab() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newContent, setNewContent] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("user_memories")
      .select("*")
      .order("consolidated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setMemories((data ?? []) as Memory[]);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const add = async () => {
    const c = newContent.trim();
    if (!c || !user) return;
    const { error } = await supabase
      .from("user_memories")
      .insert({ user_id: user.id, content: c, kind: "fact", keywords: extractKeywords(c) });
    if (error) return toast.error(error.message);
    setNewContent("");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("user_memories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setMemories((p) => p.filter((m) => m.id !== id));
  };

  const startEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditingContent(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  const saveEdit = async (id: string) => {
    const c = editingContent.trim();
    if (!c) return;
    const { error } = await supabase
      .from("user_memories")
      .update({ content: c, keywords: extractKeywords(c) })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setMemories((p) => p.map((m) => (m.id === id ? { ...m, content: c } : m)));
    cancelEdit();
  };

  const clearAll = async () => {
    if (!user) return;
    if (!confirm("Erase all memory?")) return;
    const { error } = await supabase.from("user_memories").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    setMemories([]);
  };

  const consolidate = async () => {
    if (!user) return;
    setConsolidating(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const { error } = await supabase.functions.invoke("consolidate-memory", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (error) throw error;
      toast.info("Consolidation started…");

      // Poll the runs table until the latest run finishes (max ~3 min)
      const startedAt = Date.now();
      const poll = async (): Promise<void> => {
        const { data: runs } = await supabase
          .from("memory_consolidation_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(1);
        const run = runs?.[0] as any;
        if (run && run.status !== "running" && new Date(run.started_at).getTime() > startedAt - 10000) {
          if (run.status === "success") {
            toast.success(`Consolidated ${run.before_count} → ${run.after_count} memories.`);
          } else if (run.status === "skipped") {
            toast.info("Nothing to consolidate.");
          } else {
            toast.error(run.error ?? "Consolidation failed");
          }
          await load();
          setConsolidating(false);
          return;
        }
        if (Date.now() - startedAt > 180000) {
          toast.error("Consolidation timed out. Try again later.");
          setConsolidating(false);
          return;
        }
        setTimeout(poll, 3000);
      };
      poll();
    } catch (e: any) {
      toast.error(e?.message ?? "Consolidation failed");
      setConsolidating(false);
    }
  };

  const parseImport = (raw: string): { content: string; kind: string }[] => {
    const text = raw.trim();
    if (!text) return [];
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        return json
          .map((it) => {
            if (typeof it === "string") return { content: it.trim(), kind: "fact" };
            if (it && typeof it === "object" && typeof it.content === "string") {
              return { content: String(it.content).trim(), kind: String(it.kind ?? "fact") };
            }
            return null;
          })
          .filter((x): x is { content: string; kind: string } => !!x && !!x.content);
      }
    } catch {
      // not JSON
    }
    return text
      .split(/\r?\n+/)
      .map((l) =>
        l
          .replace(/^\s*[-*•·]\s+/, "")
          .replace(/^\s*\d+[.)]\s+/, "")
          .replace(/^\s*#+\s+/, "")
          .trim(),
      )
      .filter((l) => l.length > 2)
      .map((content) => ({ content, kind: "fact" }));
  };

  const importMemories = async () => {
    if (!user) return;
    const items = parseImport(importText);
    if (items.length === 0) {
      toast.error("No memories detected in the pasted text.");
      return;
    }
    setImporting(true);
    const rows = items.map((it) => ({
      user_id: user.id,
      content: it.content,
      kind: it.kind || "fact",
      keywords: extractKeywords(it.content),
    }));
    const { error } = await supabase.from("user_memories").insert(rows);
    setImporting(false);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} memor${rows.length > 1 ? "ies" : "y"} imported.`);
    setImportText("");
    setImportOpen(false);
    load();
  };

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Memory</h2>
        <p className="text-sm text-muted-foreground">
          These memories are automatically injected into all your conversations, no matter the model or
          provider (OpenAI, Anthropic, Google). They are auto-consolidated weekly, or whenever you ask.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-medium">Add a memory</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={consolidate}
              disabled={consolidating || memories.length < 4}
              title={memories.length < 4 ? "Need at least 4 memories to consolidate" : "Group similar memories into summaries"}
            >
              {consolidating ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              Consolidate now
            </Button>
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload className="w-4 h-4 mr-1" /> Import from another AI
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Import memory from another AI</DialogTitle>
                  <DialogDescription>
                    Paste here the memory exported from ChatGPT, Claude, Gemini, etc. Accepted formats: one
                    memory per line, bullet/numbered list, or JSON (array of strings or of objects
                    {" "}
                    <code>{`{content, kind}`}</code>).
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`- I work as a full-stack developer\n- I prefer TypeScript and React\n- I live in Paris`}
                  rows={10}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {parseImport(importText).length} memor{parseImport(importText).length === 1 ? "y" : "ies"} detected.
                </p>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setImportOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={importMemories}
                    disabled={importing || parseImport(importText).length === 0}
                  >
                    <Upload className="w-4 h-4 mr-1" />
                    Import {parseImport(importText).length || ""}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <Textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="E.g. I prefer concise explanations and TypeScript code."
          rows={2}
        />
        <div className="flex justify-end">
          <Button onClick={add} disabled={!newContent.trim()} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{memories.length} memor{memories.length === 1 ? "y" : "ies"}</h3>
        {memories.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-destructive">
            Clear all
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {memories.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No memories yet. They will be created automatically as you chat.
          </p>
        )}
        {memories.map((m) => {
          const isEditing = editingId === m.id;
          const isConsolidated = !!m.consolidated_at && m.source_count > 1;
          return (
            <Card key={m.id} className="p-3 flex items-start gap-3">
              <div className="flex flex-col gap-1 shrink-0">
                <Badge variant="secondary" className="capitalize">{m.kind}</Badge>
                {isConsolidated && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-primary/30 text-primary gap-0.5"
                    title={`Summary of ${m.source_count} entries`}
                  >
                    <Sparkles className="w-2.5 h-2.5" /> ×{m.source_count}
                  </Badge>
                )}
              </div>
              {isEditing ? (
                <Textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  rows={2}
                  className="flex-1 text-sm"
                  autoFocus
                />
              ) : (
                <p className="flex-1 text-sm whitespace-pre-wrap">{m.content}</p>
              )}
              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => saveEdit(m.id)}
                      disabled={!editingContent.trim()}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(m)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(m.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
