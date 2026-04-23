import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PROVIDERS, type Provider } from "@/lib/models";
import { ExternalLink } from "lucide-react";

const DOCS: Record<Provider, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/apikey",
};

export function ApiKeysDialog({ open, onOpenChange, userId }: { open: boolean; onOpenChange: (o: boolean) => void; userId: string }) {
  const [keys, setKeys] = useState<Record<Provider, string>>({ openai: "", anthropic: "", google: "" });
  const [saving, setSaving] = useState<Provider | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from("api_keys").select("provider, api_key").then(({ data }) => {
      const next = { openai: "", anthropic: "", google: "" } as Record<Provider, string>;
      data?.forEach((row: any) => { next[row.provider as Provider] = row.api_key; });
      setKeys(next);
    });
  }, [open]);

  const save = async (provider: Provider) => {
    const value = keys[provider].trim();
    if (!value) { toast.error("Clé vide"); return; }
    setSaving(provider);
    const { error } = await supabase.from("api_keys").upsert({
      user_id: userId, provider, api_key: value,
    }, { onConflict: "user_id,provider" });
    setSaving(null);
    if (error) toast.error(error.message);
    else toast.success(`Clé ${provider} enregistrée`);
  };

  const remove = async (provider: Provider) => {
    await supabase.from("api_keys").delete().eq("provider", provider);
    setKeys({ ...keys, [provider]: "" });
    toast.success("Clé supprimée");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clés API</DialogTitle>
          <DialogDescription>
            Tes clés sont stockées de façon privée et ne sont accessibles qu'à toi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={p.id}>{p.label}</Label>
                <a href={DOCS[p.id]} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  Obtenir une clé <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex gap-2">
                <Input
                  id={p.id}
                  type="password"
                  placeholder={p.id === "openai" ? "sk-..." : p.id === "anthropic" ? "sk-ant-..." : "AIza..."}
                  value={keys[p.id]}
                  onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                />
                <Button onClick={() => save(p.id)} disabled={saving === p.id} size="sm">
                  {saving === p.id ? "..." : "Enregistrer"}
                </Button>
                {keys[p.id] && (
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>Supprimer</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
