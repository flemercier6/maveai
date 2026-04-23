import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { modelLabel, providerForModel, PROVIDER_LABEL } from "@/lib/models";
import { Loader2 } from "lucide-react";

type Row = {
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

const fmtUSD = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: v < 1 ? 4 : 2,
    maximumFractionDigits: v < 1 ? 6 : 2,
  });

const fmtTokens = (v: number) => v.toLocaleString("en-US");

export function UsageTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Aggregate | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Pull rows for this user — RLS already restricts to auth.uid()
      const { data: rows, error } = await supabase
        .from("usage_events")
        .select("model, provider, input_tokens, output_tokens, total_cost_usd")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (cancelled) return;

      if (error || !rows) {
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

      const map = new Map<
        string,
        { provider: string; requests: number; input: number; output: number; cost: number }
      >();
      let totalCost = 0;
      let totalIn = 0;
      let totalOut = 0;

      for (const r of rows as Row[]) {
        const cost = Number(r.total_cost_usd ?? 0);
        const inTok = Number(r.input_tokens ?? 0);
        const outTok = Number(r.output_tokens ?? 0);
        totalCost += cost;
        totalIn += inTok;
        totalOut += outTok;
        const cur = map.get(r.model) ?? {
          provider: r.provider,
          requests: 0,
          input: 0,
          output: 0,
          cost: 0,
        };
        cur.requests += 1;
        cur.input += inTok;
        cur.output += outTok;
        cur.cost += cost;
        map.set(r.model, cur);
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
        totalRequests: rows.length,
        byModel,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

      {/* Big total cost card */}
      <div className="rounded-xl border border-border bg-[hsl(var(--dropdown-hover))] p-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Total spent on AI
        </div>
        <div className="mt-2 text-5xl font-semibold tracking-tight text-foreground tabular-nums">
          {fmtUSD(data.totalCost)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
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
            input tokens
          </span>
          <span>
            <span className="font-medium text-foreground tabular-nums">
              {fmtTokens(data.totalOutputTokens)}
            </span>{" "}
            output tokens
          </span>
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
