import { useEffect, useState } from "react";
import { Mail, Calendar, Send, FileText, X, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";

export type GoogleActionState = "pending" | "executing" | "done" | "cancelled" | "error";

export type GoogleAction = {
  action: "gmail.draft" | "gmail.send" | "calendar.create";
  params: Record<string, unknown>;
  state: GoogleActionState;
  result?: unknown;
  error?: string;
  loading?: boolean;
};

type Props = {
  action: GoogleAction;
  onChange: (next: GoogleAction) => void;
};

function fmt(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function GoogleActionCard({ action, onChange }: Props) {
  const [params, setParams] = useState<Record<string, unknown>>(action.params);

  // When the backend sends an updated proposal (e.g. after drafting completes),
  // sync local field state with the new params.
  useEffect(() => {
    setParams(action.params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.params, action.loading]);

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

  const handleConfirm = async (overrideAction?: GoogleAction["action"]) => {
    const effectiveAction = overrideAction ?? action.action;
    // Strip UI-only fields before sending
    const cleanParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith("_")) cleanParams[k] = v;
    }
    onChange({ ...action, action: effectiveAction, state: "executing", params: cleanParams });
    try {
      const { data, error } = await supabase.functions.invoke("google-tools", {
        body: { action: effectiveAction, params: cleanParams },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      const result = (data as { result?: unknown })?.result;
      onChange({ ...action, action: effectiveAction, state: "done", params: cleanParams, result });
      const successMsg =
        effectiveAction === "gmail.draft"
          ? "Brouillon enregistré"
          : effectiveAction === "gmail.send"
            ? "Email envoyé"
            : "Événement créé";
      toast.success(successMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action échouée";
      onChange({ ...action, action: effectiveAction, state: "error", params: cleanParams, error: msg });
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
        <div className="flex items-center gap-2 text-base">
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
  const loading = !!action.loading;

  // ---------- Confirmation card ----------
  return (
    <div className="my-2 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[hsl(var(--dropdown-hover))]">
        <Icon className="w-4 h-4 text-foreground/70" />
        <span className="font-medium text-foreground text-base">{title}</span>
      </div>

      <div className="p-3 space-y-2 text-sm">
        {loading ? (
          isEmail ? <EmailSkeleton /> : <EventSkeleton />
        ) : (
          <>
            {isEmail ? <EmailFields params={params} onChange={setParams} /> : null}
            {isEvent ? <EventFields params={params} onChange={setParams} /> : null}
          </>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 bg-background">
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy || loading}
          className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-dropdown-hover transition-colors disabled:opacity-50 text-base"
        >
          Annuler
        </button>
        {isEmail ? (
          <>
            <button
              type="button"
              onClick={() => handleConfirm("gmail.draft")}
              disabled={busy || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-dropdown-hover transition-colors disabled:opacity-50 text-base"
            >
              {busy && action.action === "gmail.draft" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              Enregistrer comme brouillon
            </button>
            <button
              type="button"
              onClick={() => handleConfirm("gmail.send")}
              disabled={busy || loading}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-60 text-base",
              )}
            >
              {busy && action.action === "gmail.send" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Envoyer
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => handleConfirm()}
            disabled={busy || loading}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-60 text-base",
            )}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {primaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- Sub-views ----------

function FieldRow({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-muted-foreground w-[60px] shrink-0 text-base">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring text-base"
    />
  );
}

function EmailFields({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  const showCc = !!fmt(params.cc) || (params as { _showCc?: boolean })._showCc;
  const showBcc = !!fmt(params.bcc) || (params as { _showBcc?: boolean })._showBcc;

  return (
    <>
      <FieldRow
        label="À"
        action={
          (!showCc || !showBcc) && (
            <div className="flex items-center text-base gap-0">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => onChange({ ...params, _showCc: true })}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-dropdown-hover transition-colors"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => onChange({ ...params, _showBcc: true })}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-dropdown-hover transition-colors"
                >
                  Cci
                </button>
              )}
            </div>
          )
        }
      >
        <TextInput value={fmt(params.to)} onChange={(v) => set("to", v)} placeholder="email@example.com" />
      </FieldRow>
      {showCc && (
        <FieldRow label="Cc">
          <TextInput value={fmt(params.cc)} onChange={(v) => set("cc", v)} placeholder="cc@example.com" />
        </FieldRow>
      )}
      {showBcc && (
        <FieldRow label="Cci">
          <TextInput value={fmt(params.bcc)} onChange={(v) => set("bcc", v)} placeholder="cci@example.com" />
        </FieldRow>
      )}
      <FieldRow label="Objet">
        <TextInput value={fmt(params.subject)} onChange={(v) => set("subject", v)} placeholder="Sujet" />
      </FieldRow>
      <div className="flex gap-2">
        <label className="text-muted-foreground w-[60px] shrink-0 pt-2 text-base">Corps</label>
        <AutoResizeTextarea
          value={fmt(params.body)}
          onChange={(v) => set("body", v)}
          placeholder="Contenu de l'email"
          minHeight={80}
          maxHeight={400}
        />
      </div>
    </>
  );
}

function EventFields({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...params, [k]: v });
  const attendees = Array.isArray(params.attendees)
    ? (params.attendees as string[]).join(", ")
    : "";

  return (
    <>
      <FieldRow label="Titre">
        <TextInput value={fmt(params.summary)} onChange={(v) => set("summary", v)} placeholder="Titre" />
      </FieldRow>
      <FieldRow label="Début">
        <TextInput value={fmt(params.start)} onChange={(v) => set("start", v)} placeholder="ISO 8601" />
      </FieldRow>
      <FieldRow label="Fin">
        <TextInput value={fmt(params.end)} onChange={(v) => set("end", v)} placeholder="ISO 8601" />
      </FieldRow>
      <FieldRow label="Lieu">
        <TextInput value={fmt(params.location)} onChange={(v) => set("location", v)} placeholder="Lieu" />
      </FieldRow>
      <FieldRow label="Invités">
        <TextInput
          value={attendees}
          onChange={(v) =>
            onChange({
              ...params,
              attendees: v.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="email1@..., email2@..."
        />
      </FieldRow>
      <div className="flex gap-2">
        <label className="text-muted-foreground w-[60px] shrink-0 pt-2 text-base">Détails</label>
        <AutoResizeTextarea
          value={fmt(params.description)}
          onChange={(v) => set("description", v)}
          placeholder="Description"
          minHeight={60}
          maxHeight={400}
        />
      </div>
    </>
  );
}

// ---------- Skeletons (shown while the LLM drafts the email/event) ----------

function SkeletonRow({ labelWidth = "w-6", inputWidth = "w-full" }: { labelWidth?: string; inputWidth?: string }) {
  return (
    <div className="flex items-center gap-2">
      <SkeletonShimmer className={cn("h-3 shrink-0", labelWidth)} style={{ width: 60 }} />
      <SkeletonShimmer className={cn("h-8", inputWidth)} />
    </div>
  );
}

function EmailSkeleton() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <div className="flex gap-2">
        <SkeletonShimmer className="h-3 shrink-0" style={{ width: 60 }} />
        <SkeletonShimmer className="h-32 flex-1" />
      </div>
    </>
  );
}

function EventSkeleton() {
  return (
    <>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <div className="flex gap-2">
        <SkeletonShimmer className="h-3 shrink-0" style={{ width: 60 }} />
        <SkeletonShimmer className="h-20 flex-1" />
      </div>
    </>
  );
}
