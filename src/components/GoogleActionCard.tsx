import { useState } from "react";
import { Mail, Calendar, Send, FileText, X, Check, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type GoogleActionState = "pending" | "executing" | "done" | "cancelled" | "error";

export type GoogleAction = {
  action: "gmail.draft" | "gmail.send" | "calendar.create";
  params: Record<string, unknown>;
  state: GoogleActionState;
  result?: unknown;
  error?: string;
};

type Props = {
  action: GoogleAction;
  onChange: (next: GoogleAction) => void;
};

function fmt(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function formatDateTimeRange(start?: string, end?: string): string {
  if (!start) return "";
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    };
    const ds = s.toLocaleString(undefined, dateOpts);
    if (!e) return ds;
    const sameDay = s.toDateString() === e.toDateString();
    const eFmt = sameDay
      ? e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : e.toLocaleString(undefined, dateOpts);
    return `${ds} → ${eFmt}`;
  } catch {
    return `${start}${end ? ` → ${end}` : ""}`;
  }
}

export function GoogleActionCard({ action, onChange }: Props) {
  const [params, setParams] = useState<Record<string, unknown>>(action.params);

  const isEmail = action.action === "gmail.draft" || action.action === "gmail.send";
  const isEvent = action.action === "calendar.create";
  const Icon = isEmail ? Mail : Calendar;

  const title =
    action.action === "gmail.draft"
      ? "Brouillon Gmail"
      : action.action === "gmail.send"
        ? "Envoyer un email"
        : "Créer un événement";

  const primaryLabel =
    action.action === "gmail.draft"
      ? "Créer le brouillon"
      : action.action === "gmail.send"
        ? "Envoyer"
        : "Créer l'événement";

  const handleConfirm = async () => {
    onChange({ ...action, state: "executing", params });
    try {
      const { data, error } = await supabase.functions.invoke("google-tools", {
        body: { action: action.action, params },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const result = (data as { result?: unknown })?.result;
      onChange({ ...action, state: "done", params, result });
      const successMsg =
        action.action === "gmail.draft"
          ? "Brouillon créé"
          : action.action === "gmail.send"
            ? "Email envoyé"
            : "Événement créé";
      toast.success(successMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action échouée";
      onChange({ ...action, state: "error", params, error: msg });
      toast.error(msg);
    }
  };

  const handleCancel = () => {
    onChange({ ...action, state: "cancelled" });
  };

  // ---------- Result view ----------
  if (action.state === "done") {
    const r = action.result as Record<string, unknown> | undefined;
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-foreground/80 text-base">
          <Check className="w-4 h-4 text-[hsl(140_70%_42%)]" />
          <span className="font-medium text-foreground text-base">
            {action.action === "gmail.draft" && "Brouillon enregistré dans Gmail"}
            {action.action === "gmail.send" && "Email envoyé"}
            {action.action === "calendar.create" && "Événement créé"}
          </span>
        </div>
        {action.action === "calendar.create" && r?.htmlLink ? (
          <a
            href={String(r.htmlLink)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs text-foreground/60 hover:underline"
          >
            Voir dans Google Calendar →
          </a>
        ) : null}
      </div>
    );
  }

  if (action.state === "cancelled") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <X className="w-4 h-4" />
          Action annulée
        </div>
      </div>
    );
  }

  if (action.state === "error") {
    return (
      <div className="my-2 rounded-xl border border-border bg-card p-3 text-sm">
        <div className="flex items-center gap-2 text-destructive">
          <X className="w-4 h-4" />
          <span className="font-medium text-foreground text-base">Échec de l'action</span>
        </div>
        {action.error ? (
          <p className="mt-1 text-xs text-muted-foreground">{action.error}</p>
        ) : null}
      </div>
    );
  }

  const busy = action.state === "executing";

  // ---------- Confirmation card ----------
  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[hsl(var(--dropdown-hover))]">
        <Icon className="w-4 h-4 text-foreground/70" />
        <span className="font-medium text-foreground text-base">{title}</span>
      </div>

      <div className="p-3 space-y-2 text-sm">
        {isEmail ? (
          <EmailFields
            params={params}
            editing={editing}
            onChange={setParams}
          />
        ) : null}
        {isEvent ? (
          <EventFields
            params={params}
            editing={editing}
            onChange={setParams}
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-background">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          disabled={busy}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {editing ? "Aperçu" : "Modifier"}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm hover:bg-dropdown-hover transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60",
            )}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : action.action === "gmail.send" ? (
              <Send className="w-3.5 h-3.5" />
            ) : action.action === "gmail.draft" ? (
              <FileText className="w-3.5 h-3.5" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-views ----------

function Field({
  label,
  value,
  editing,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  if (!editing) {
    if (!value) return null;
    return (
      <div className="grid grid-cols-[60px_1fr] gap-2">
        <span className="text-xs text-muted-foreground pt-0.5">{label}</span>
        <span
          className={cn(
            "text-sm text-foreground",
            multiline && "whitespace-pre-wrap",
          )}
        >
          {value}
        </span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[60px_1fr] gap-2">
      <label className="text-xs text-muted-foreground pt-2">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  );
}

function EmailFields({
  params,
  editing,
  onChange,
}: {
  params: Record<string, unknown>;
  editing: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  return (
    <>
      <Field label="À" value={fmt(params.to)} editing={editing} onChange={(v) => set("to", v)} placeholder="email@example.com" />
      <Field label="Cc" value={fmt(params.cc)} editing={editing} onChange={(v) => set("cc", v)} />
      <Field label="Objet" value={fmt(params.subject)} editing={editing} onChange={(v) => set("subject", v)} placeholder="Sujet" />
      <Field label="Corps" value={fmt(params.body)} editing={editing} onChange={(v) => set("body", v)} multiline placeholder="Contenu de l'email" />
    </>
  );
}

function EventFields({
  params,
  editing,
  onChange,
}: {
  params: Record<string, unknown>;
  editing: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  const attendees = Array.isArray(params.attendees)
    ? (params.attendees as string[]).join(", ")
    : "";

  if (!editing) {
    return (
      <>
        <Field label="Titre" value={fmt(params.summary)} editing={false} onChange={() => {}} />
        <div className="grid grid-cols-[60px_1fr] gap-2">
          <span className="text-xs text-muted-foreground pt-0.5">Quand</span>
          <span className="text-sm text-foreground">
            {formatDateTimeRange(fmt(params.start), fmt(params.end))}
          </span>
        </div>
        <Field label="Lieu" value={fmt(params.location)} editing={false} onChange={() => {}} />
        <Field label="Invités" value={attendees} editing={false} onChange={() => {}} />
        <Field label="Détails" value={fmt(params.description)} editing={false} onChange={() => {}} multiline />
      </>
    );
  }

  return (
    <>
      <Field label="Titre" value={fmt(params.summary)} editing onChange={(v) => set("summary", v)} />
      <Field label="Début" value={fmt(params.start)} editing onChange={(v) => set("start", v)} placeholder="ISO 8601" />
      <Field label="Fin" value={fmt(params.end)} editing onChange={(v) => set("end", v)} placeholder="ISO 8601" />
      <Field label="Lieu" value={fmt(params.location)} editing onChange={(v) => set("location", v)} />
      <Field
        label="Invités"
        value={attendees}
        editing
        onChange={(v) =>
          onChange({
            ...params,
            attendees: v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        }
        placeholder="email1@..., email2@..."
      />
      <Field label="Détails" value={fmt(params.description)} editing onChange={(v) => set("description", v)} multiline />
    </>
  );
}
