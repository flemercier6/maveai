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
import { Plus, Trash2, Upload, Sparkles, Check, X, Pencil, Loader2, Lock, FlaskConical, Copy } from "lucide-react";
import { toast } from "sonner";
import { extractKeywords } from "@/lib/keywords";
import { usePlan } from "@/hooks/usePlan";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { Switch } from "@/components/ui/switch";
import { billedCostEur } from "@/lib/pricing";

// Memory is auto-compressed once the user has spent ~CONSOLIDATION_THRESHOLD_EUR
// in billed tokens since the last successful consolidation. Compression fires at 95%.
const CONSOLIDATION_THRESHOLD_EUR = 1;
const CONSOLIDATION_TRIGGER_RATIO = 0.95;

type Memory = {
  id: string;
  title: string | null;
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
  const [editingTitle, setEditingTitle] = useState("");
  const { isFree } = usePlan();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [spentEur, setSpentEur] = useState(0);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [memoryMode, setMemoryMode] = useState<"classic" | "smart">("classic");
  const [savingMode, setSavingMode] = useState(false);

  const loadMode = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("ai_preferences")
      .select("memory_mode")
      .eq("user_id", user.id)
      .maybeSingle();
    const mode = (data as { memory_mode?: string } | null)?.memory_mode;
    setMemoryMode(mode === "smart" ? "smart" : "classic");
  };

  const toggleMode = async (next: boolean) => {
    if (!user) return;
    if (isFree) { setShowUpgrade(true); return; }
    const newMode: "classic" | "smart" = next ? "smart" : "classic";
    setMemoryMode(newMode); // optimistic
    setSavingMode(true);
    const { error } = await supabase
      .from("ai_preferences")
      .upsert({ user_id: user.id, memory_mode: newMode }, { onConflict: "user_id" });
    setSavingMode(false);
    if (error) {
      toast.error(error.message);
      setMemoryMode(newMode === "smart" ? "classic" : "smart");
      return;
    }
    toast.success(newMode === "smart" ? "Smart memory enabled (experimental)" : "Classic memory restored");
  };


  const load = async () => {
    const { data } = await supabase
      .from("user_memories")
      .select("*")
      .order("consolidated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    setMemories((data ?? []) as Memory[]);
  };

  const loadSpend = async () => {
    if (!user) return;
    // Find last successful consolidation; spend is summed from that point on.
    const { data: runs } = await supabase
      .from("memory_consolidation_runs")
      .select("finished_at")
      .eq("user_id", user.id)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1);
    const since = runs?.[0]?.finished_at as string | undefined;
    let q = supabase
      .from("usage_events")
      .select("model, total_cost_usd")
      .eq("user_id", user.id);
    if (since) q = q.gt("created_at", since);
    const { data: events } = await q;
    const total = (events ?? []).reduce(
      (sum, e: any) => sum + billedCostEur(Number(e.total_cost_usd) || 0, String(e.model || "")),
      0,
    );
    setSpentEur(total);
  };

  useEffect(() => {
    if (user) {
      load();
      loadSpend();
      loadMode();
    }
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
    setEditingTitle(m.title ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
    setEditingTitle("");
  };

  const saveEdit = async (id: string) => {
    const c = editingContent.trim();
    if (!c) return;
    const t = editingTitle.trim() || null;
    const { error } = await supabase
      .from("user_memories")
      .update({ content: c, title: t, keywords: extractKeywords(`${t ?? ""} ${c}`) })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setMemories((p) => p.map((m) => (m.id === id ? { ...m, content: c, title: t } : m)));
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
          await loadSpend();
          setConsolidating(false);
          return;
        }
        if (Date.now() - startedAt > 180000) {
          toast.error("Consolidation timed out. Try again later.");
          setConsolidating(false);
          return;
        }
        setTimeout(poll, 1000);
      };
      setTimeout(poll, 800);
    } catch (e: any) {
      toast.error(e?.message ?? "Consolidation failed");
      setConsolidating(false);
    }
  };

  const CATEGORY_TO_KIND: Record<string, string> = {
    instructions: "instruction",
    instruction: "instruction",
    identity: "identity",
    career: "career",
    projects: "project",
    project: "project",
    preferences: "preference",
    preference: "preference",
  };

  const stripCodeFences = (s: string): string => {
    const m = s.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    return m ? m[1] : s;
  };

  const parseImport = (raw: string): { content: string; kind: string }[] => {
    const text = stripCodeFences(raw.trim());
    if (!text) return [];
    // Try JSON first
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

    const lines = text.split(/\r?\n/);
    const out: { content: string; kind: string }[] = [];
    let currentKind = "fact";
    const headerRe = /^\s*(?:#+\s*)?(?:\d+[.)]\s*)?\*{0,2}\s*(instructions?|identity|career|projects?|preferences?)\s*\*{0,2}\s*:?\s*$/i;
    const dateLineRe = /^\s*[-*•·]?\s*\[(?:\d{4}-\d{2}-\d{2}|unknown)\]\s*[-–—:]?\s*(.+)$/i;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const h = line.match(headerRe);
      if (h) {
        currentKind = CATEGORY_TO_KIND[h[1].toLowerCase()] ?? "fact";
        continue;
      }
      const d = line.match(dateLineRe);
      if (d) {
        const content = d[1].trim();
        if (content.length > 1) out.push({ content, kind: currentKind });
        continue;
      }
      const cleaned = line
        .replace(/^\s*[-*•·]\s+/, "")
        .replace(/^\s*\d+[.)]\s+/, "")
        .replace(/^\s*#+\s+/, "")
        .replace(/^\*+|\*+$/g, "")
        .trim();
      if (cleaned.length > 2 && !/^[-=_]{3,}$/.test(cleaned)) {
        out.push({ content: cleaned, kind: currentKind });
      }
    }
    return out;
  };

  const IMPORT_PROMPT = `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:

- Wrap the entire export in a single code block for easy copying.

- After the code block, state whether this is the complete set or if more remain.`;

  const [promptCopied, setPromptCopied] = useState(false);
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT);
      setPromptCopied(true);
      toast.success("Prompt copied");
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
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

  const ratio = Math.max(0, Math.min(1, spentEur / CONSOLIDATION_THRESHOLD_EUR));
  const pct = Math.round(ratio * 100);

  // Auto-trigger consolidation once the user crosses the trigger ratio.
  useEffect(() => {
    if (!user || isFree) return;
    if (consolidating || autoTriggered) return;
    if (ratio >= CONSOLIDATION_TRIGGER_RATIO) {
      setAutoTriggered(true);
      consolidate();
    }
  }, [ratio, user, isFree, consolidating, autoTriggered]);

  // Circular ring
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * ratio;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-semibold text-lg">Memory</h2>
        <p className="text-sm text-muted-foreground">
          These memories are automatically injected into all your conversations, no matter the model or
          provider (OpenAI, Anthropic, Google). They are auto-consolidated once you've used roughly
          €{CONSOLIDATION_THRESHOLD_EUR.toFixed(2)} worth of tokens (compression triggers at 95%), or
          whenever you ask.
        </p>
      </div>

      <Card className="p-4 flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={ratio >= CONSOLIDATION_TRIGGER_RATIO ? "hsl(var(--switch-on))" : "hsl(var(--primary))"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              style={{ transition: "stroke-dasharray 0.5s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
            {pct}%
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Compression cycle</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            €{spentEur.toFixed(3)} used of €{CONSOLIDATION_THRESHOLD_EUR.toFixed(2)} before the next
            auto-compression.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { if (isFree) { setShowUpgrade(true); return; } consolidate(); }}
          disabled={consolidating}
        >
          {consolidating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
          Compress now
        </Button>
      </Card>

      {isFree && (
        <div className="rounded-[8px] border border-border bg-[hsl(var(--dropdown-hover))] p-3 flex items-start gap-3">
          <Lock className="w-4 h-4 mt-0.5 text-foreground/60 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Memory is a Plus feature</div>
            <p className="text-muted-foreground text-xs mt-0.5">
              Free users can view their existing memories, but new memories are not added or injected into conversations.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowUpgrade(true)}>
            <Sparkles className="w-4 h-4 mr-1" /> Upgrade
          </Button>
        </div>
      )}

      <UpgradeDialog open={showUpgrade} onOpenChange={setShowUpgrade} reason="memory" />

      <Card className="p-4 flex items-start gap-4">
        <div className="mt-0.5 shrink-0 rounded-[8px] bg-[hsl(var(--dropdown-hover))] p-2">
          <FlaskConical className="w-4 h-4 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-base">Smart memory</h3>
            <Badge variant="outline" className="text-xs">Experimental</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Replaces the classic extractor with a 3-stage pipeline (heuristic pre-filter → mini-LLM
            judge → embedding-based dedup). Top facts are injected only at the start of new
            conversations, ranked by confidence. Runs fully in background — no impact on chat
            latency.
          </p>
        </div>
        <Switch
          checked={memoryMode === "smart"}
          onCheckedChange={toggleMode}
          disabled={savingMode}
          aria-label="Toggle smart memory"
        />
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-medium text-base">Add a memory</h3>
          <div className="flex items-center gap-2">
            <Dialog open={importOpen} onOpenChange={(o) => { if (o && isFree) { setShowUpgrade(true); return; } setImportOpen(o); }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={isFree}>
                  <Upload className="w-4 h-4 mr-1" /> Import from another AI
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Import memory from another AI</DialogTitle>
                  <DialogDescription>
                    Step 1 — Copy the prompt below and send it to ChatGPT, Claude, Gemini, etc.
                    Step 2 — Paste their full response (including the code block) in the area below.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Prompt to send to the other AI</span>
                    <Button variant="outline" size="sm" onClick={copyPrompt}>
                      {promptCopied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                      {promptCopied ? "Copied" : "Copy prompt"}
                    </Button>
                  </div>
                  <div className="rounded-[8px] border border-border bg-[hsl(var(--dropdown-hover))] p-3 text-xs whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                    {IMPORT_PROMPT}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium">Paste the AI's response here</span>
                  <Textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`\`\`\`\n## Instructions\n[2024-03-12] - Always answer in French.\n\n## Identity\n[unknown] - Lives in Paris.\n\n## Preferences\n[2024-05-01] - Prefers concise explanations.\n\`\`\``}
                    rows={10}
                    className="font-mono text-xs"
                  />
                  <p className="text-muted-foreground text-sm">
                    {parseImport(importText).length} memor{parseImport(importText).length === 1 ? "y" : "ies"} detected.
                  </p>
                </div>

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
          <Button
            onClick={() => { if (isFree) { setShowUpgrade(true); return; } add(); }}
            disabled={!newContent.trim()}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="font-medium text-base">{memories.length} memor{memories.length === 1 ? "y" : "ies"}</h3>
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
                <div className="flex-1 flex flex-col gap-2">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    placeholder="Title (optional)"
                    className="w-full text-sm font-semibold bg-transparent border-b border-border focus:outline-none focus:border-primary px-1 py-0.5"
                  />
                  <Textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    rows={3}
                    className="text-sm"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  {m.title && (
                    <div className="text-sm font-semibold mb-1">{m.title}</div>
                  )}
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{m.content}</p>
                </div>
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
