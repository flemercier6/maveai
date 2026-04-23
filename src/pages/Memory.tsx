import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Brain, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Memory = {
  id: string;
  content: string;
  kind: string;
  created_at: string;
};

export default function Memory() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [newContent, setNewContent] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate("/signin", { replace: true });
  }, [loading, user, navigate]);

  const load = async () => {
    const { data } = await supabase
      .from("user_memories")
      .select("*")
      .order("created_at", { ascending: false });
    setMemories((data ?? []) as Memory[]);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const add = async () => {
    const c = newContent.trim();
    if (!c) return;
    const { error } = await supabase
      .from("user_memories")
      .insert({ user_id: user!.id, content: c, kind: "fact" });
    if (error) return toast.error(error.message);
    setNewContent("");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("user_memories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setMemories((p) => p.filter((m) => m.id !== id));
  };

  const clearAll = async () => {
    if (!confirm("Effacer toute la mémoire ?")) return;
    const { error } = await supabase.from("user_memories").delete().eq("user_id", user!.id);
    if (error) return toast.error(error.message);
    setMemories([]);
  };

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="h-14 border-b border-border flex items-center px-4 gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Brain className="w-5 h-5 text-primary" />
        <h1 className="font-semibold">Mémoire</h1>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <p className="text-sm text-muted-foreground">
          Ces souvenirs sont injectés automatiquement dans toutes tes conversations, peu importe le modèle ou
          le fournisseur (OpenAI, Anthropic, Google).
        </p>

        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-medium">Ajouter un souvenir</h2>
          <Textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Ex: Je préfère les explications concises et le code en TypeScript."
            rows={2}
          />
          <div className="flex justify-end">
            <Button onClick={add} disabled={!newContent.trim()} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Ajouter
            </Button>
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{memories.length} souvenir{memories.length > 1 ? "s" : ""}</h2>
          {memories.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-destructive">
              Tout effacer
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {memories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Aucun souvenir pour l'instant. Ils seront créés automatiquement au fil des conversations.
            </p>
          )}
          {memories.map((m) => (
            <Card key={m.id} className="p-3 flex items-start gap-3">
              <Badge variant="secondary" className="shrink-0 capitalize">{m.kind}</Badge>
              <p className="flex-1 text-sm">{m.content}</p>
              <Button variant="ghost" size="icon" onClick={() => remove(m.id)} className="h-7 w-7 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
