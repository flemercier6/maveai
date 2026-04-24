import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { modelLabel, providerForModel, PROVIDER_LABEL } from "@/lib/models";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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

const fmtUSD = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: v < 1 ? 4 : 2,
    maximumFractionDigits: v < 1 ? 6 : 2,
  });

const fmtUSDShort = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: v < 1 ? 3 : 2,
    maximumFractionDigits: v < 1 ? 3 : 2,
  });

const fmtTokens = (v: number) => v.toLocaleString("en-US");

// Build buckets ending at "now", going back N units.
function buildBuckets(range: Range): { key: string; label: string; start: Date; end: Date }[] {
  const now = new Date();
  const buckets: { key: string; label: string; start: Date; end: Date }[] = [];

  if (range === "day") {
    // Last 24 hours, hourly
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    for (let i = 23; i >= 0; i--) {
      const start = new Date(base.getTime() - i * 3600_000);
      const end = new Date(start.getTime() + 3600_000);
      buckets.push({
        key: start.toISOString(),
        label: start.toLocaleTimeString("en-US", { hour: "2-digit", hour12: false }),
        start,
        end,
      });
    }
  } else if (range === "week") {
    // Last 7 days
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 6; i >= 0; i--) {
      const start = new Date(base.getTime() - i * 86_400_000);
      const end = new Date(start.getTime() + 86_400_000);
      buckets.push({
        key: start.toISOString(),
        label: start.toLocaleDateString("en-US", { weekday: "short" }),
        start,
        end,
      });
    }
  } else if (range === "month") {
    // Last 30 days
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = 29; i >= 0; i--) {
      const start = new Date(base.getTime() - i * 86_400_000);
      const end = new Date(start.getTime() + 86_400_000);
      buckets.push({
        key: start.toISOString(),
        label: start.toLocaleDateString("en-US", { day: "2-digit", month: "short" }),
        start,
        end,
      });
    }
  } else {
    // Year: last 12 months
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({
        key: start.toISOString(),
        label: start.toLocaleDateString("en-US", { month: "short" }),
        start,
        end,
      });
    }
  }

  return buckets;
}

export function UsageTab() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [data, setData] = useState<Aggregate | null>(null);
  const [range, setRange] = useState<Range>("week");

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

  const chartData = useMemo(() => {
    const buckets = buildBuckets(range);
    const totals = new Array(buckets.length).fill(0);
    for (const row of rows) {
      const t = new Date(row.created_at).getTime();
      // Binary-friendly linear scan: buckets are short (max 30)
      for (let i = 0; i < buckets.length; i++) {
        if (t >= buckets[i].start.getTime() && t < buckets[i].end.getTime()) {
          totals[i] += Number(row.total_cost_usd ?? 0) * 3; // billed price ×3
          break;
        }
      }
    }
    return buckets.map((b, i) => ({ label: b.label, spend: totals[i] }));
  }, [rows, range]);

  const periodTotal = useMemo(
    () => chartData.reduce((sum, d) => sum + d.spend, 0),
    [chartData],
  );

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
        <div className="rounded-xl border border-border bg-[hsl(var(--dropdown-hover))] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No usage recorded yet. Send a message to start tracking.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Usage</h2>

      {/* Big total cost cards: base + ×3 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-[hsl(var(--dropdown-hover))] p-6">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Total spent on AI
          </div>
          <div className="mt-2 font-semibold tracking-tight text-foreground tabular-nums text-xl">
            {fmtUSD(data.totalCost)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {fmtTokens(data.totalRequests)}
              </span>{" "}
              requests
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {fmtTokens(data.totalInputTokens)}
              </span>{" "}
              in
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {fmtTokens(data.totalOutputTokens)}
              </span>{" "}
              out
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-foreground text-background p-6">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">
              Billed price
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-background/15 px-2 py-0.5">
              ×3
            </span>
          </div>
          <div className="mt-2 font-semibold tracking-tight tabular-nums text-xl">
            {fmtUSD(data.totalCost * 3)}
          </div>
          <div className="mt-3 text-xs opacity-70">
            Margin applied on top of provider list price.
          </div>
        </div>
      </div>

      {/* Spend over time */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Spend over time</h3>
            <p className="text-xs text-muted-foreground">
              Billed price (×3) ·{" "}
              <span className="font-medium text-foreground tabular-nums">
                {fmtUSD(periodTotal)}
              </span>{" "}
              this {range}
            </p>
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
                tickFormatter={(v) => fmtUSDShort(Number(v))}
                width={56}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--dropdown-hover))" }}
                contentStyle={{
                  background: "hsl(var(--tooltip))",
                  border: "none",
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "hsl(var(--tooltip-foreground))",
                }}
                labelStyle={{ color: "hsl(var(--tooltip-foreground))", opacity: 0.7 }}
                formatter={(v: number) => [fmtUSD(Number(v)), "Spend"]}
              />
              <Bar dataKey="spend" fill="hsl(var(--foreground))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-model breakdown */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">By model</h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Model</th>
                <th className="text-right font-medium px-3 py-2">Requests</th>
                <th className="text-right font-medium px-3 py-2">Input</th>
                <th className="text-right font-medium px-3 py-2">Output</th>
                <th className="text-right font-medium px-3 py-2">Cost</th>
                <th className="text-right font-medium px-3 py-2">×3</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((row) => {
                const provider = providerForModel(row.model);
                return (
                  <tr key={row.model} className="border-t border-border">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{modelLabel(row.model)}</div>
                      <div className="text-xs text-muted-foreground">
                        {PROVIDER_LABEL[provider] ?? row.provider}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtTokens(row.requests)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {fmtTokens(row.input_tokens)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {fmtTokens(row.output_tokens)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                      {fmtUSD(row.cost)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {fmtUSD(row.cost * 3)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Costs are based on each provider's public per-token list price.
        </p>
      </div>
    </section>
  );
}
