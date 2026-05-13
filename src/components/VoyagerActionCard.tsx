import { useMemo, useState } from "react";
import { Check, Loader2, X, UserRound, Building2, Briefcase, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
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
  // Optional context the backend can pass for nicer display
  targetLabel?: string; // e.g. "Thibault Chancerelle"
};

type Props = {
  action: VoyagerAction;
  onChange: (next: VoyagerAction) => void;
};

const METHOD_VERB: Record<VoyagerAction["method"], string> = {
  POST: "Créer",
  PATCH: "Modifier",
  DELETE: "Supprimer",
};

const RESOURCE_LABEL: Record<VoyagerAction["resource"], string> = {
  contacts: "contact",
  companies: "société",
  deals: "deal",
};

const RESOURCE_ICON: Record<VoyagerAction["resource"], typeof UserRound> = {
  contacts: UserRound,
  companies: Building2,
  deals: Briefcase,
};

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  first_name: "Prénom",
  firstName: "Prénom",
  last_name: "Nom",
  lastName: "Nom",
  name: "Nom",
  full_name: "Nom complet",
  phone: "Téléphone",
  mobile: "Mobile",
  company: "Société",
  company_name: "Société",
  job_title: "Poste",
  title: "Titre",
  position: "Poste",
  address: "Adresse",
  city: "Ville",
  country: "Pays",
  zip: "Code postal",
  postal_code: "Code postal",
  website: "Site web",
  notes: "Notes",
  description: "Description",
  amount: "Montant",
  stage: "Étape",
  status: "Statut",
  tags: "Tags",
};

function humanizeKey(k: string) {
  if (FIELD_LABELS[k]) return FIELD_LABELS[k];
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function VoyagerActionCard({ action, onChange }: Props) {
  const [payloadText, setPayloadText] = useState<string>(
    action.payload ? JSON.stringify(action.payload, null, 2) : "",
  );
  const [advanced, setAdvanced] = useState(false);

  const Icon = RESOURCE_ICON[action.resource];
  const MethodIcon = action.method === "POST" ? Plus : action.method === "DELETE" ? Trash2 : Pencil;

  const target = action.targetLabel || (action.id ? `#${action.id.slice(0, 6)}` : RESOURCE_LABEL[action.resource]);
  const title = `${METHOD_VERB[action.method]} ${RESOURCE_LABEL[action.resource]}`;

  const fields = useMemo(() => {
    const p = action.payload || {};
    return Object.entries(p);
  }, [action.payload]);

  const confirm = async () => {
    let parsedPayload: Record<string, unknown> | undefined = action.payload;
    if (advanced && action.method !== "DELETE" && payloadText.trim()) {
      try {
        parsedPayload = JSON.parse(payloadText);
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
      toast.success(`${title} : OK`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action échouée";
      onChange({ ...action, state: "error", payload: parsedPayload, error: msg });
      toast.error(msg);
    }
  };

  const cancel = () => onChange({ ...action, state: "cancelled" });

  if (action.state === "done") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[hsl(140_70%_42%)]/10 flex items-center justify-center">
          <Check className="w-3.5 h-3.5 text-[hsl(140_70%_42%)]" />
        </div>
        <span className="text-base text-foreground">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground"> · {target} · effectué</span>
        </span>
      </div>
    );
  }

  if (action.state === "cancelled") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-2 text-muted-foreground">
        <X className="w-4 h-4" />
        <span className="text-base">Action annulée</span>
      </div>
    );
  }

  if (action.state === "error") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2 text-destructive">
          <X className="w-4 h-4" />
          <span className="font-medium text-foreground text-base">Échec — {title}</span>
        </div>
        {action.error && <p className="mt-1 text-sm text-muted-foreground">{action.error}</p>}
      </div>
    );
  }

  const busy = action.state === "executing";

  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative w-9 h-9 rounded-full bg-dropdown-hover flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-foreground/80" strokeWidth={1.75} />
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center">
            <MethodIcon className="w-2.5 h-2.5" strokeWidth={2.5} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-foreground truncate">{title}</div>
          <div className="text-sm text-muted-foreground truncate">{target}</div>
        </div>
      </div>

      {/* Body */}
      {action.method === "DELETE" ? (
        <div className="px-4 pb-3 text-base text-muted-foreground">
          Cette action est <span className="text-foreground font-medium">irréversible</span>.
        </div>
      ) : fields.length > 0 ? (
        <div className="px-4 pb-3">
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {fields.map(([k, v]) => (
              <div key={k} className="flex items-start gap-3 px-3 py-2">
                <div className="text-sm text-muted-foreground w-28 shrink-0 pt-0.5">{humanizeKey(k)}</div>
                <div className="text-base text-foreground break-all flex-1">{formatValue(v)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Advanced */}
      {action.method !== "DELETE" && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => setAdvanced((s) => !s)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${advanced ? "rotate-180" : ""}`} />
            {advanced ? "Masquer le JSON" : "Afficher le JSON avancé"}
          </button>
          {advanced && (
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[12px] resize-y min-h-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-dropdown-hover">
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-card transition-colors disabled:opacity-50 text-base"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-60 text-base"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {action.method === "DELETE" ? "Supprimer" : "Confirmer"}
        </button>
      </div>
    </div>
  );
}
