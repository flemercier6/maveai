import { useEffect, useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Check, Loader2, FileText } from "lucide-react";

type Cycle = "daily" | "weekly" | "monthly";
type Card = {
  id: string;
  stripe_payment_method_id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
};
type Account = {
  plan: "free" | "plus";
  billing_cycle: Cycle;
  status: "active" | "past_due" | "suspended";
  next_billing_at?: string | null;
};
type Invoice = {
  id: string;
  period_start: string;
  period_end: string;
  amount_eur: number;
  status: "pending" | "paid" | "failed" | "skipped_below_threshold";
  created_at: string;
};
type Status = {
  account: Account;
  cards: Card[];
  outstandingEur: number;
  invoices: Invoice[];
};

// The Stripe publishable key is fetched from the backend (billing-config edge
// function) so the user never has to provide it. Publishable keys are safe to
// live client-side.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(pk: string) {
  if (!stripePromise) stripePromise = loadStripe(pk);
  return stripePromise;
}

function CardForm({
  onSuccess,
  buttonLabel,
}: {
  onSuccess: (paymentMethodId: string) => Promise<void>;
  buttonLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "billing-setup-intent",
        { body: {} },
      );
      if (fnErr || !data?.clientSecret) throw new Error(fnErr?.message ?? "Setup intent failed");
      const card = elements.getElement(CardElement);
      if (!card) throw new Error("Card element missing");
      const result = await stripe.confirmCardSetup(data.clientSecret, {
        payment_method: { card },
      });
      if (result.error) throw new Error(result.error.message);
      const pmId = result.setupIntent?.payment_method;
      if (typeof pmId !== "string") throw new Error("No payment method id");
      await onSuccess(pmId);
      card.clear();
    } catch (err) {
      toast({
        title: "Erreur",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="border border-border rounded-md p-3 bg-background">
        <CardElement options={{ hidePostalCode: true }} />
      </div>
      <Button type="submit" disabled={!stripe || loading} size="sm">
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {buttonLabel}
      </Button>
    </form>
  );
}

export function BillingTab() {
  const { toast } = useToast();
  const [pk, setPk] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<Cycle>("monthly");

  async function reload() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("billing-status", { body: {} });
    if (!error && data) {
      setStatus(data as Status);
      setCycle((data as Status).account.billing_cycle);
    }
    setLoading(false);
  }
  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("billing-config", { body: {} });
      setPk((data as { publishableKey?: string } | null)?.publishableKey ?? null);
    })();
    reload();
  }, []);

  async function activatePlus(paymentMethodId: string) {
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "activate_plus", paymentMethodId, cycle },
    });
    if (error) throw new Error(error.message);
    toast({ title: "Plan Plus activé" });
    await reload();
  }
  async function addCard(paymentMethodId: string) {
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "add_card", paymentMethodId },
    });
    if (error) throw new Error(error.message);
    toast({ title: "Carte ajoutée" });
    await reload();
  }
  async function setDefault(pmId: string) {
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "set_default_card", paymentMethodId: pmId },
    });
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else await reload();
  }
  async function removeCard(pmId: string) {
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "remove_card", paymentMethodId: pmId },
    });
    if (error || (data as { error?: string })?.error) {
      toast({
        title: "Impossible",
        description: error?.message ?? (data as { error?: string }).error,
        variant: "destructive",
      });
    } else await reload();
  }
  async function changeCycle(newCycle: Cycle) {
    setCycle(newCycle);
    if (status?.account.plan !== "plus") return;
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "set_cycle", cycle: newCycle },
    });
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else await reload();
  }
  async function downgrade() {
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "downgrade" },
    });
    if (error || (data as { error?: string })?.error) {
      toast({
        title: "Impossible",
        description: error?.message ?? (data as { error?: string }).error,
        variant: "destructive",
      });
    } else {
      toast({ title: "Repassé en plan Free" });
      await reload();
    }
  }

  if (!pk) {
    return (
      <section className="space-y-2 max-w-xl">
        <h2 className="text-lg font-semibold">Billing</h2>
        <p className="text-sm text-muted-foreground">
          Le système de paiement n'est pas encore configuré. Réessayez dans
          quelques instants.
        </p>
      </section>
    );
  }

  if (loading || !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  const isPlus = status.account.plan === "plus";

  return (
    <Elements stripe={getStripe(pk)}>
      <section className="space-y-6 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">Billing</h2>
          <p className="text-sm text-muted-foreground">
            Plan{" "}
            <strong>{isPlus ? "Plus (pay-as-you-go)" : "Free"}</strong>
            {status.account.status !== "active" && isPlus && (
              <span className="ml-2 text-destructive">
                · {status.account.status === "suspended" ? "suspendu" : "paiement en retard"}
              </span>
            )}
          </p>
        </div>

        {/* Current usage */}
        {isPlus && (
          <div className="border border-border rounded-md p-4 bg-card space-y-1">
            <div className="text-xs text-muted-foreground">Consommation en cours</div>
            <div className="text-2xl font-semibold">
              {status.outstandingEur.toFixed(2)} €
            </div>
            {status.account.next_billing_at && (
              <div className="text-xs text-muted-foreground">
                Prochain prélèvement le{" "}
                {new Date(status.account.next_billing_at).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground pt-1">
              En dessous de 1 €, le prélèvement est reporté à la période suivante.
            </div>
          </div>
        )}

        {/* Cycle */}
        <div className="space-y-2">
          <Label className="text-sm">Fréquence de prélèvement</Label>
          <RadioGroup value={cycle} onValueChange={(v) => changeCycle(v as Cycle)}>
            {([
              ["daily", "Tous les jours"],
              ["weekly", "Toutes les semaines"],
              ["monthly", "Tous les mois"],
            ] as const).map(([v, label]) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`cycle-${v}`} />
                <Label htmlFor={`cycle-${v}`} className="text-sm font-normal cursor-pointer">
                  {label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Cards */}
        <div className="space-y-2">
          <Label className="text-sm">Cartes enregistrées</Label>
          {status.cards.length === 0 && (
            <p className="text-xs text-muted-foreground">Aucune carte enregistrée.</p>
          )}
          {status.cards.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between border border-border rounded-md p-3"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="capitalize">{c.brand}</span>
                <span>•••• {c.last4}</span>
                <span className="text-muted-foreground">
                  {c.exp_month?.toString().padStart(2, "0")}/{c.exp_year?.toString().slice(-2)}
                </span>
                {c.is_default && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-primary font-medium">
                    par défaut
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!c.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDefault(c.stripe_payment_method_id)}
                    title="Définir par défaut"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCard(c.stripe_payment_method_id)}
                  title="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Add card / Activate */}
        <div className="space-y-2">
          <Label className="text-sm">
            {isPlus ? "Ajouter une nouvelle carte" : "Activer le plan Plus avec une carte"}
          </Label>
          <CardForm
            onSuccess={isPlus ? addCard : activatePlus}
            buttonLabel={isPlus ? "Ajouter la carte" : "Passer au plan Plus"}
          />
        </div>

        {/* Downgrade */}
        {isPlus && (
          <div className="pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={downgrade}>
              Revenir au plan Free
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">
              Possible uniquement si la consommation en cours est à 0 €.
            </p>
          </div>
        )}

        {/* Invoices */}
        {status.invoices.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm">Historique des paiements</Label>
            <div className="border border-border rounded-md divide-y divide-border overflow-hidden">
              {status.invoices.map((inv) => {
                const dateLabel = new Date(inv.created_at).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });
                const periodLabel = `${new Date(inv.period_start).toLocaleDateString("fr-FR")} → ${new Date(inv.period_end).toLocaleDateString("fr-FR")}`;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {inv.amount_eur.toFixed(2)} €
                        </span>
                        <span className="text-muted-foreground">· {dateLabel}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground truncate">
                        Période {periodLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={
                          inv.status === "paid"
                            ? "text-foreground"
                            : inv.status === "failed"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {inv.status === "paid" && "Payé"}
                        {inv.status === "failed" && "Échec"}
                        {inv.status === "pending" && "En attente"}
                        {inv.status === "skipped_below_threshold" && "Reporté (< 1 €)"}
                      </span>
                      {inv.status === "paid" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] gap-1"
                          onClick={async () => {
                            const { data, error } = await supabase.functions.invoke(
                              "billing-receipt",
                              { body: { invoice_id: inv.id } },
                            );
                            const url = (data as { url?: string } | null)?.url;
                            if (error || !url) {
                              toast({
                                title: "Justificatif indisponible",
                                description:
                                  error?.message ??
                                  (data as { error?: string } | null)?.error ??
                                  "Reçu non encore disponible.",
                                variant: "destructive",
                              });
                              return;
                            }
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <FileText className="w-3 h-3" />
                          Justificatif
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </Elements>
  );
}
