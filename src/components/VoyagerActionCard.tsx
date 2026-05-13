import { useState } from "react";
import { Check, Loader2, X, HardDrive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type VoyagerActionState = "pending" | "executing" | "done" | "cancelled" | "error";

export type VoyagerAction = {
  resource: "contacts" | "companies" | "deals";
  method: "POST" | "PATCH" | "DELETE";
  id?: string;
  payload?: Record<string, unknown>;
  state: VoyagerActionState;
  result?: unknown;
  error?: string;
};

type Props = {
  action: VoyagerAction;
  onChange: (next: VoyagerAction) => void;
};

const METHOD_VERB: Record<VoyagerAction["method"], string> = {
  POST: "Créer",
  PATCH: "Mettre à jour",
  DELETE: "Supprimer",
};

const RESOURCE_LABEL: Record<VoyagerAction["resource"], string> = {
  contacts: "contact",
  companies: "société",
  deals: "deal",
};

export function VoyagerActionCard({ action, onChange }: Props) {
  const [payload, setPayload] = useState<string>(
    action.payload ? JSON.stringify(action.payload, null, 2) : "",
  );

  const title = `${METHOD_VERB[action.method]} ${RESOURCE_LABEL[action.resource]}${action.id ? ` (${action.id.slice(0, 8)}…)` : ""}`;

  const confirm = async () => {
    let parsedPayload: Record<string, unknown> | undefined;
    if (action.method !== "DELETE" && payload.trim()) {
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        toast.error("Payload JSON invalide");
        return;
      }
    }
    onChange({ ...action, state: "executing", payload: parsedPayload });
    try {
      const { data, error } = await supabase.functions.invoke("voyager-crm", {
        body: {
          resource: action.resource,
          method: action.method,
          id: action.id,
          payload: parsedPayload,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; status?: number; data?: unknown; error?: string };
      if (d?.error || d?.ok === false) {
        throw new Error(d.error || `Voyager API error (${d.status})`);
      }
      onChange({ ...action, state: "done", payload: parsedPayload, result: d.data });
      toast.success(`${METHOD_VERB[action.method]} ${RESOURCE_LABEL[action.resource]} : OK`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action échouée";
      onChange({ ...action, state: "error", payload: parsedPayload, error: msg });
      toast.error(msg);
    }
  };

  const cancel = () => onChange({ ...action, state: "cancelled" });

  if (action.state === "done") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-foreground/80 text-base">
          <Check className="w-4 h-4 text-[hsl(140_70%_42%)]" />
          <span className="font-medium text-foreground">{title} — réussi</span>
        </div>
      </div>
    );
  }
  if (action.state === "cancelled") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 text-base">
          <X className="w-4 h-4" /> Action annulée
        </div>
      </div>
    );
  }
  if (action.state === "error") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-destructive">
          <X className="w-4 h-4" />
          <span className="font-medium text-foreground">Échec</span>
        </div>
        {action.error && <p className="mt-1 text-xs text-muted-foreground">{action.error}</p>}
      </div>
    );
  }

  const busy = action.state === "executing";

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[hsl(var(--dropdown-hover))]">
        <HardDrive className="w-4 h-4 text-foreground/70" />
        <span className="font-medium text-foreground text-base">{title}</span>
        <span className="ml-auto text-[11px] text-muted-foreground font-mono">
          {action.method} /{action.resource}
          {action.id ? `/${action.id.slice(0, 8)}…` : ""}
        </span>
      </div>
      {action.method !== "DELETE" && (
        <div className="p-3">
          <label className="text-muted-foreground text-base">Payload (JSON)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[12px] resize-y min-h-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
            spellCheck={false}
          />
        </div>
      )}
      {action.method === "DELETE" && (
        <div className="p-3 text-sm text-muted-foreground">
          Confirme la suppression de ce {RESOURCE_LABEL[action.resource]}. Cette action est irréversible.
        </div>
      )}
      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-background">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-dropdown-hover transition-colors disabled:opacity-50 text-base"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-60 text-base"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {action.method === "DELETE" ? "Supprimer" : "Confirmer"}
        </button>
      </div>
    </div>
  );
}
