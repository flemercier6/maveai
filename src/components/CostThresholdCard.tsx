import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bell, BellOff, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Period = "day" | "week" | "month";

type Threshold = {
  id: string;
  amount_eur: number;
  period: Period;
  enabled: boolean;
  last_notified_period_start: string | null;
};

const PERIOD_LABEL: Record<Period, string> = {
  day: "jour",
  week: "semaine",
  month: "mois",
};

function startOfPeriod(p: Period, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (p === "day") return d;
  if (p === "week") {
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const fmtEUR = (v: number) =>
  v.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type Props = {
  /** Current spend in EUR for the selected periods (computed by parent from billed totals). */
  spendByPeriod: Record<Period, number>;
};

export function CostThresholdCard({ spendByPeriod }: Props) {
  const { user } = useAuth();
  const [threshold, setThreshold] = useState<Threshold | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftAmount, setDraftAmount] = useState("10");
  const [draftPeriod, setDraftPeriod] = useState<Period>("month");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("cost_thresholds")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setThreshold(data as Threshold);
        setDraftAmount(String(data.amount_eur));
        setDraftPeriod(data.period as Period);
      } else {
        setEditing(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const currentSpend = threshold ? spendByPeriod[threshold.period] ?? 0 : 0;
  const ratio = threshold ? currentSpend / Number(threshold.amount_eur) : 0;
  const reached = ratio >= 1;

  // Fire a one-time toast per period when threshold is reached.
  useEffect(() => {
    if (!threshold || !threshold.enabled || !reached || !user) return;
    const periodStart = startOfPeriod(threshold.period).toISOString();
    if (threshold.last_notified_period_start === periodStart) return;

    toast.warning(
      `Seuil de dépense atteint : ${fmtEUR(currentSpend)} ce ${PERIOD_LABEL[threshold.period]} (limite ${fmtEUR(Number(threshold.amount_eur))})`,
      { duration: 8000 },
    );

    void supabase
      .from("cost_thresholds")
      .update({
        last_notified_at: new Date().toISOString(),
        last_notified_period_start: periodStart,
      })
      .eq("id", threshold.id)
      .then(({ data }) => {
        if (data) return;
        setThreshold((t) =>
          t ? { ...t, last_notified_period_start: periodStart } : t,
        );
      });
  }, [threshold, reached, currentSpend, user]);

  async function save() {
    if (!user) return;
    const amount = Number(draftAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Montant invalide");
      return;
    }
    const payload = {
      user_id: user.id,
      amount_eur: amount,
      period: draftPeriod,
      enabled: true,
      // Reset notif state so a new alert can fire under the new rule
      last_notified_period_start: null,
    };
    const { data, error } = await supabase
      .from("cost_thresholds")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) {
      toast.error("Impossible d'enregistrer le seuil");
      return;
    }
    setThreshold(data as Threshold);
    setEditing(false);
    toast.success("Seuil enregistré");
  }

  async function toggleEnabled() {
    if (!threshold) return;
    const next = !threshold.enabled;
    const { data } = await supabase
      .from("cost_thresholds")
      .update({ enabled: next })
      .eq("id", threshold.id)
      .select()
      .single();
    if (data) setThreshold(data as Threshold);
  }

  if (loading) return null;

  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        reached && threshold?.enabled
          ? "border-amber-300 bg-amber-50"
          : "border-border bg-[hsl(var(--dropdown-hover))]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {reached && threshold?.enabled ? (
            <Bell className="w-4 h-4 text-amber-600" />
          ) : threshold?.enabled ? (
            <Bell className="w-4 h-4 text-foreground" />
          ) : (
            <BellOff className="w-4 h-4 text-muted-foreground" />
          )}
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Spending threshold
          </div>
        </div>
        {threshold && !editing && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleEnabled}
              className="text-xs px-2 py-1 rounded-[4px] hover:bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              {threshold.enabled ? "Désactiver" : "Activer"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-[4px] hover:bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Modifier"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Recevez une alerte lorsque vos dépenses atteignent ce montant sur la période choisie.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground">M'avertir si j'atteins</span>
            <div className="relative">
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
                className="w-24 h-8 pl-2 pr-6 text-sm rounded-[4px] border border-border bg-background tabular-nums focus:outline-none focus:ring-1 focus:ring-foreground"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                €
              </span>
            </div>
            <span className="text-sm text-foreground">par</span>
            <div className="inline-flex rounded-[4px] border border-border p-0.5 bg-background">
              {(["day", "week", "month"] as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraftPeriod(p)}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-[3px] transition-colors",
                    draftPeriod === p
                      ? "bg-foreground text-background font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {threshold && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraftAmount(String(threshold.amount_eur));
                    setDraftPeriod(threshold.period);
                  }}
                  className="p-1.5 rounded-[4px] hover:bg-background/60 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Annuler"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={save}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-[4px] bg-foreground text-background hover:opacity-90 transition-opacity"
              >
                <Check className="w-3.5 h-3.5" /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : threshold ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm text-foreground">
              <span className="font-semibold tabular-nums">{fmtEUR(currentSpend)}</span>
              <span className="text-muted-foreground"> / {fmtEUR(Number(threshold.amount_eur))} </span>
              <span className="text-muted-foreground">par {PERIOD_LABEL[threshold.period]}</span>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              {Math.min(999, Math.round(ratio * 100))}%
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-background overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                reached ? "bg-amber-500" : "bg-foreground",
              )}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          {!threshold.enabled && (
            <p className="text-xs text-muted-foreground">
              Notifications désactivées.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
