import { useEffect, useState } from "react";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Check, Loader2, FileText, Sparkles } from "lucide-react";

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
        title: "Error",
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
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [showAddCardForm, setShowAddCardForm] = useState(false);

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
    toast({ title: "Plus plan activated" });
    await reload();
  }
  async function addCard(paymentMethodId: string) {
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "add_card", paymentMethodId },
    });
    if (error) throw new Error(error.message);
    toast({ title: "Card added" });
    await reload();
  }
  async function setDefault(pmId: string) {
    const { error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "set_default_card", paymentMethodId: pmId },
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else await reload();
  }
  async function removeCard(pmId: string) {
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "remove_card", paymentMethodId: pmId },
    });
    if (error || (data as { error?: string })?.error) {
      toast({
        title: "Unable to remove card",
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
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else await reload();
  }
  async function downgrade() {
    const { data, error } = await supabase.functions.invoke("billing-manage", {
      body: { action: "downgrade" },
    });
    if (error || (data as { error?: string })?.error) {
      toast({
        title: "Unable to downgrade",
        description: error?.message ?? (data as { error?: string }).error,
        variant: "destructive",
      });
    } else {
      toast({ title: "Switched back to Free plan" });
      await reload();
    }
  }

  if (!pk) {
    return (
      <section className="space-y-2 max-w-xl">
        <h2 className="text-lg font-semibold">Plans & Billing</h2>
        <p className="text-sm text-muted-foreground">
          The payment system is not configured yet. Please try again in a few moments.
        </p>
      </section>
    );
  }

  if (loading || !status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  const isPlus = status.account.plan === "plus";

  // Free users see a Free vs Plus comparison first. The existing payment
  // settings (cycle, cards, activation form) only appear after they click
  // "Upgrade to Plus".
  if (!isPlus && !showUpgradeForm) {
    return (
      <Elements stripe={getStripe(pk)}>
        <section className="space-y-6 max-w-2xl">
          <div>
            <h2 className="text-lg font-semibold">Plans & Billing</h2>
            <p className="text-sm text-muted-foreground">
              You're on the <strong>Free</strong> plan. Upgrade to Plus for full access, pay-as-you-go.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Free */}
            <div className="border border-border rounded-md p-4 bg-card flex flex-col gap-3">
              <div>
                <div className="font-medium uppercase tracking-wide text-muted-foreground text-sm">Free</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold">€0</span>
                  <span className="text-muted-foreground text-sm">/ month</span>
                </div>
              </div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-foreground/60" />
                  5 requests / day
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-foreground/60" />
                  Standard models only
                </li>
                <li className="flex items-start gap-2 text-muted-foreground">
                  <span className="w-3.5 h-3.5 mt-0.5 shrink-0 text-center leading-none">—</span>
                  No memory
                </li>
                <li className="flex items-start gap-2 text-muted-foreground">
                  <span className="w-3.5 h-3.5 mt-0.5 shrink-0 text-center leading-none">—</span>
                  No saved chats or projects
                </li>
              </ul>
              <div className="mt-auto pt-2">
                <Button variant="outline" size="sm" disabled className="w-full">
                  Current plan
                </Button>
              </div>
            </div>

            {/* Plus */}
            <div className="border border-primary/40 rounded-md p-4 bg-card flex flex-col gap-3 relative">
              <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary font-medium">
                <Sparkles className="w-3 h-3" /> Recommended
              </div>
              <div>
                <div className="font-medium uppercase tracking-wide text-primary text-sm">Plus</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold">Pay-as-you-go</span>
                </div>
                <div className="text-muted-foreground mt-0.5 text-sm">
                  Billed on actual usage. No fixed fee.
                </div>
              </div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  Unlimited requests
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  All models (GPT-5.5, Claude Opus 4.7, Gemini Pro, Mistral Large…)
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  Memory enabled
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                  Saved chats, folders & projects
                </li>
              </ul>
              <div className="mt-auto pt-2">
                <Button size="sm" className="w-full" onClick={() => setShowUpgradeForm(true)}>
                  Upgrade to Plus
                </Button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            You'll be charged based on actual usage. Below €1, the charge is deferred to the next period.
          </p>
        </section>
      </Elements>
    );
  }

  return (
    <Elements stripe={getStripe(pk)}>
      <section className="space-y-6 max-w-2xl">
        <div>
          <h2 className="text-lg font-semibold">Plans & Billing</h2>
          <p className="text-sm text-muted-foreground">
            Plan{" "}
            <strong>{isPlus ? "Plus (pay-as-you-go)" : "Free"}</strong>
            {status.account.status !== "active" && isPlus && (
              <span className="ml-2 text-destructive">
                · {status.account.status === "suspended" ? "suspended" : "past due"}
              </span>
            )}
          </p>
          {!isPlus && (
            <button
              type="button"
              onClick={() => setShowUpgradeForm(false)}
              className="text-muted-foreground underline mt-1 text-sm"
            >
              ← Back to plan comparison
            </button>
          )}
        </div>

        {/* Current usage */}
        {isPlus && (
          <div className="border border-border rounded-md p-4 bg-card space-y-1">
            <div className="text-xs text-muted-foreground">Current usage</div>
            <div className="text-2xl font-semibold">
              {status.outstandingEur.toFixed(2)} €
            </div>
            {status.account.next_billing_at && (
              <div className="text-xs text-muted-foreground">
                Next charge on{" "}
                {new Date(status.account.next_billing_at).toLocaleDateString("en-US", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground pt-1">
              Below €1, the charge is deferred to the next period.
            </div>
          </div>
        )}

        {/* Cycle */}
        <div className="space-y-2">
          <Label className="text-sm">Billing frequency</Label>
          <RadioGroup value={cycle} onValueChange={(v) => changeCycle(v as Cycle)}>
            {([
              ["daily", "Daily"],
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
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
          <Label className="text-sm">Saved cards</Label>
          {status.cards.length === 0 && (
            <p className="text-xs text-muted-foreground">No saved cards.</p>
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
                    default
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!c.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDefault(c.stripe_payment_method_id)}
                    title="Set as default"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCard(c.stripe_payment_method_id)}
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Add card / Activate */}
        {isPlus ? (
          showAddCardForm ? (
            <div className="rounded-[8px] border border-border bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Add a new card</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddCardForm(false)}
                >
                  Cancel
                </Button>
              </div>
              <CardForm
                onSuccess={async (pmId) => {
                  await addCard(pmId);
                  setShowAddCardForm(false);
                }}
                buttonLabel="Add card"
              />
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddCardForm(true)}
            >
              Add a new card
            </Button>
          )
        ) : (
          <div className="rounded-[8px] border border-border bg-background p-4 space-y-2">
            <Label className="text-sm">Activate the Plus plan with a card</Label>
            <CardForm onSuccess={activatePlus} buttonLabel="Upgrade to Plus" />
          </div>
        )}

        {/* Downgrade */}
        {isPlus && (
          <div className="pt-2 border-t border-border">
            <Button variant="outline" size="sm" onClick={downgrade}>
              Switch back to Free
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">
              Only possible when current usage is at €0.
            </p>
          </div>
        )}

        {/* Invoices */}
        {status.invoices.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm">Payment history</Label>
            <div className="border border-border rounded-md divide-y divide-border overflow-hidden">
              {status.invoices.map((inv) => {
                const dateLabel = new Date(inv.created_at).toLocaleDateString("en-US", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                });
                const periodLabel = `${new Date(inv.period_start).toLocaleDateString("en-US")} → ${new Date(inv.period_end).toLocaleDateString("en-US")}`;
                return (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-base">
                          {inv.amount_eur.toFixed(2)} €
                        </span>
                        <span className="text-muted-foreground">· {dateLabel}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground truncate">
                        Period {periodLabel}
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
                        {inv.status === "paid" && "Paid"}
                        {inv.status === "failed" && "Failed"}
                        {inv.status === "pending" && "Pending"}
                        {inv.status === "skipped_below_threshold" && "Deferred (< €1)"}
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
                                title: "Receipt unavailable",
                                description:
                                  error?.message ??
                                  (data as { error?: string } | null)?.error ??
                                  "Receipt not available yet.",
                                variant: "destructive",
                              });
                              return;
                            }
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <FileText className="w-3 h-3" />
                          Receipt
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
