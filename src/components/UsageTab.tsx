import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useAuth } from "@/hooks/useAuth";
import { modelLabel, providerForModel, PROVIDER_LABEL } from "@/lib/models";
import { billingMultiplier, billedCost, USD_TO_EUR } from "@/lib/pricing";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CostThresholdCard } from "@/components/CostThresholdCard";
import { ProviderLogo } from "@/components/ProviderLogo";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  created_at: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
};

type Aggregate = {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  byModel: {
    model: string;
    provider: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }[];
};

type Range = "day" | "week" | "month" | "year";

const RANGES: { id: Range; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const fmtEUR = (v: number) =>
  (v * USD_TO_EUR).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtEURShort = (v: number) =>
  (v * USD_TO_EUR).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtTokens = (v: number) => v.toLocaleString("en-US");

// Build buckets ending at "now", going back N units.
type Bucket = { label: string; start: Date; end: Date };

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
// ISO-like week start (Monday)
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - day);
  return x;
}

// Build buckets for a given range + offset.
// offset = 0 means current period; -1 = previous; +1 = next.
function buildBuckets(
  range: Range,
  offset: number,
  signupDate: Date,
): { buckets: Bucket[]; title: string } {
  const now = new Date();

  if (range === "day") {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const buckets: Bucket[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      buckets.push({
        label: String(d),
        start: new Date(year, month, d),
        end: new Date(year, month, d + 1),
      });
    }
    return {
      buckets,
      title: ref.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }

  if (range === "week") {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const monthStart = startOfMonth(ref);
    const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const buckets: Bucket[] = [];
    let cur = startOfWeek(monthStart);
    while (cur < monthEnd) {
      const end = new Date(cur.getTime() + 7 * 86_400_000);
      buckets.push({
        label: `${cur.getDate()}/${cur.getMonth() + 1}`,
        start: new Date(cur),
        end,
      });
      cur = end;
    }
    return {
      buckets,
      title: ref.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }

  if (range === "month") {
    const year = now.getFullYear() + offset;
    const buckets: Bucket[] = [];
    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      buckets.push({
        label: start.toLocaleDateString("en-US", { month: "short" }),
        start,
        end: new Date(year, m + 1, 1),
      });
    }
    return { buckets, title: String(year) };
  }

  // year — from signup year to current year
  const startYear = signupDate.getFullYear();
  const endYear = now.getFullYear();
  const buckets: Bucket[] = [];
  for (let y = startYear; y <= endYear; y++) {
    buckets.push({
      label: String(y),
      start: new Date(y, 0, 1),
      end: new Date(y + 1, 0, 1),
    });
  }
  return { buckets, title: `${startYear} – ${endYear}` };
}

function canNavigate(
  range: Range,
  offset: number,
  direction: -1 | 1,
  signupDate: Date,
): boolean {
  if (range === "year") return false;
  const now = new Date();
  const next = offset + direction;
  if (range === "day" || range === "week") {
    const target = new Date(now.getFullYear(), now.getMonth() + next, 1);
    if (direction > 0) return target <= startOfMonth(now);
    return target >= startOfMonth(signupDate);
  }
  const targetYear = now.getFullYear() + next;
  if (direction > 0) return targetYear <= now.getFullYear();
  return targetYear >= signupDate.getFullYear();
}

export function UsageTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useDeveloperMode();
  const [rows, setRows] = useState<Row[]>([]);
  const [data, setData] = useState<Aggregate | null>(null);
  const [range, setRange] = useState<Range>("week");
  const [offset, setOffset] = useState(0);

  const signupDate = useMemo(
    () => (user?.created_at ? new Date(user.created_at) : new Date()),
    [user?.created_at],
  );

  // Reset offset when switching range
  useEffect(() => {
    setOffset(0);
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: r, error } = await supabase
        .from("usage_events")
        .select("created_at, model, provider, input_tokens, output_tokens, total_cost_usd")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (cancelled) return;

      if (error || !r) {
        setRows([]);
        setData({
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalRequests: 0,
          byModel: [],
        });
        setLoading(false);
        return;
      }

      const typed = r as Row[];
      setRows(typed);

      const map = new Map<
        string,
        { provider: string; requests: number; input: number; output: number; cost: number }
      >();
      let totalCost = 0;
      let totalIn = 0;
      let totalOut = 0;

      for (const row of typed) {
        const cost = Number(row.total_cost_usd ?? 0);
        const inTok = Number(row.input_tokens ?? 0);
        const outTok = Number(row.output_tokens ?? 0);
        totalCost += cost;
        totalIn += inTok;
        totalOut += outTok;
        const cur = map.get(row.model) ?? {
          provider: row.provider,
          requests: 0,
          input: 0,
          output: 0,
          cost: 0,
        };
        cur.requests += 1;
        cur.input += inTok;
        cur.output += outTok;
        cur.cost += cost;
        map.set(row.model, cur);
      }

      const byModel = Array.from(map.entries())
        .map(([model, v]) => ({
          model,
          provider: v.provider,
          requests: v.requests,
          input_tokens: v.input,
          output_tokens: v.output,
          cost: v.cost,
        }))
        .sort((a, b) => b.cost - a.cost);

      setData({
        totalCost,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        totalRequests: typed.length,
        byModel,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { buckets, title } = useMemo(
    () => buildBuckets(range, offset, signupDate),
    [range, offset, signupDate],
  );

  const chartData = useMemo(() => {
    const totals = new Array(buckets.length).fill(0);
    for (const row of rows) {
      const t = new Date(row.created_at).getTime();
      for (let i = 0; i < buckets.length; i++) {
        if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) {
          // Per-model markup: cheap models get a higher multiplier.
          totals[i] += billedCost(Number(row.total_cost_usd ?? 0), row.model);
          break;
        }
      }
    }
    return buckets.map((b, i) => ({ label: b.label, spend: totals[i] }));
  }, [rows, buckets]);

  const periodTotal = useMemo(
    () => chartData.reduce((sum, d) => sum + d.spend, 0),
    [chartData],
  );

  // Total billed across the whole dataset (per-model markup applied row by row).
  const totalBilled = useMemo(
    () => rows.reduce((s, r) => s + billedCost(Number(r.total_cost_usd ?? 0), r.model), 0),
    [rows],
  );

  // Billed spend (EUR) for the current day / week / month — used by the threshold card.
  const spendByPeriod = useMemo(() => {
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startWeek = new Date(startDay);
    startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let day = 0,
      week = 0,
      month = 0;
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      const billedEur = billedCost(Number(r.total_cost_usd ?? 0), r.model) * USD_TO_EUR;
      if (t >= startMonth.getTime()) month += billedEur;
      if (t >= startWeek.getTime()) week += billedEur;
      if (t >= startDay.getTime()) day += billedEur;
    }
    return { day, week, month };
  }, [rows]);

  const canPrev = canNavigate(range, offset, -1, signupDate);
  const canNext = canNavigate(range, offset, 1, signupDate);

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Usage</h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading usage…
        </div>
      </section>
    );
  }

  if (!data || data.totalRequests === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Usage</h2>
        <CostThresholdCard spendByPeriod={{ day: 0, week: 0, month: 0 }} />
        <div className="rounded-xl border border-border bg-[hsl(var(--dropdown-hover))] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No usage recorded yet. Send a message to start tracking.
          </p>
        </div>
        <DeveloperModeCard enabled={devMode} onChange={setDevMode} />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Usage</h2>

      <CostThresholdCard spendByPeriod={spendByPeriod} />


      {/* Total billed cost card */}
      <div className="rounded-xl border border-border bg-foreground text-background p-6">
        <div className="font-medium text-foreground text-sm uppercase tracking-wide opacity-70 text-sm">
          Total spent on AI
        </div>
        <div className="mt-2 font-semibold tracking-tight tabular-nums text-sm text-xl">
          {fmtEUR(totalBilled)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 opacity-70 text-sm">
          <span>
            <span className="font-medium tabular-nums text-sm">
              {fmtTokens(data.totalRequests)}
            </span>{" "}
            requests
          </span>
          <span>
            <span className="font-medium tabular-nums text-sm">
              {fmtTokens(data.totalInputTokens)}
            </span>{" "}
            in
          </span>
          <span>
            <span className="font-medium tabular-nums text-sm">
              {fmtTokens(data.totalOutputTokens)}
            </span>{" "}
            out
          </span>
        </div>
      </div>

      {/* Spend over time */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-base">Spend over time</h3>
          </div>
          <div className="inline-flex rounded-[6px] border border-border p-0.5 bg-[hsl(var(--dropdown-hover))]">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-[4px] transition-colors",
                  range === r.id
                    ? "bg-background text-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Period navigator */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => canPrev && setOffset((o) => o - 1)}
            disabled={!canPrev}
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded-[4px] border border-border transition-colors",
              canPrev
                ? "hover:bg-[hsl(var(--dropdown-hover))] text-foreground"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
            aria-label="Previous period"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-xs font-medium tabular-nums">{title}</div>
          <button
            type="button"
            onClick={() => canNext && setOffset((o) => o + 1)}
            disabled={!canNext}
            className={cn(
              "h-7 w-7 flex items-center justify-center rounded-[4px] border border-border transition-colors",
              canNext
                ? "hover:bg-[hsl(var(--dropdown-hover))] text-foreground"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
            aria-label="Next period"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => fmtEURShort(Number(v))}
                width={56}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--dropdown-hover))" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const v = Number(payload[0].value ?? 0);
                  return (
                    <div className="rounded-[4px] bg-tooltip text-tooltip-foreground text-xs px-2 py-1 shadow-md">
                      <div className="opacity-70">{label}</div>
                      <div className="font-semibold tabular-nums">{fmtEUR(v)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="spend" fill="hsl(var(--foreground))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-model breakdown */}
      <div className="space-y-2">
        <h3 className="font-semibold text-base">By model</h3>
        <div className="space-y-1">
          {data.byModel.map((row) => {
            const provider = providerForModel(row.model);
            const mult = billingMultiplier(row.model);
            return (
              <div key={row.model} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ProviderLogo provider={provider} className="w-5 h-5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-base truncate">{modelLabel(row.model)}</div>
                    <div className="text-muted-foreground text-sm truncate">
                      {PROVIDER_LABEL[provider] ?? row.provider}
                    </div>
                  </div>
                </div>
                <div className="text-right tabular-nums font-semibold text-base shrink-0">
                  {fmtEUR(row.cost * mult)}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground text-sm">
          Costs are based on each provider's public per-token list price.
        </p>
      </div>

      <DeveloperModeCard enabled={devMode} onChange={setDevMode} />
    </section>
  );
}

function DeveloperModeCard({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4 flex items-start justify-between gap-4 text-base">
      <div className="min-w-0">
        <div className="text-sm font-semibold">Developer Mode</div>
        <p className="mt-1 text-muted-foreground text-sm">
          Affiche sous chaque réponse de l'IA un dropdown de breakdown détaillé
          (tokens et coût en €) pour comprendre ce qui pèse le plus dans la requête.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onChange}
        aria-label="Toggle developer mode"
      />
    </div>
  );
}
