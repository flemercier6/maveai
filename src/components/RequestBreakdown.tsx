import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequestMeta } from "@/lib/requestMeta";
import { USD_TO_EUR } from "@/lib/pricing";

const fmtTok = (n: number) => n.toLocaleString("en-US");
const fmtEur = (usd: number) =>
  (usd * USD_TO_EUR).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: usd * USD_TO_EUR < 0.01 ? 4 : 3,
    maximumFractionDigits: 4,
  });

type Segment = {
  label: string;
  tokens: number;
  costUsd: number;
  detail?: string;
};

export function RequestBreakdown({ meta }: { meta: RequestMeta }) {
  const [open, setOpen] = useState(false);

  const cost = meta.cost;
  const inputPricePerTok = cost && cost.inputTokens > 0 ? cost.inputCostUsd / cost.inputTokens : 0;
  const mult = cost?.multiplier ?? 1;

  // Build per-segment breakdown for the input side.
  const segments: Segment[] = [];

  for (const s of meta.systems) {
    segments.push({
      label: `System · ${s.label}`,
      tokens: s.approxTokens,
      costUsd: s.approxTokens * inputPricePerTok * mult,
    });
  }

  if (meta.memoryMatches.length > 0) {
    const memTokens = meta.memoryMatches.reduce(
      (s, m) => s + Math.ceil(m.content.length / 4),
      0,
    );
    segments.push({
      label: `Memory matches (${meta.memoryMatches.length})`,
      tokens: memTokens,
      costUsd: memTokens * inputPricePerTok * mult,
    });
  }

  if (meta.webContext) {
    segments.push({
      label: `Web context · ${meta.webContext.label}`,
      tokens: meta.webContext.approxTokens,
      costUsd: meta.webContext.approxTokens * inputPricePerTok * mult,
    });
  }

  const histTokens = meta.history.reduce((s, h) => s + h.approxTokens, 0);
  if (histTokens > 0) {
    segments.push({
      label: `Conversation history (${meta.history.length} msgs)`,
      tokens: histTokens,
      costUsd: histTokens * inputPricePerTok * mult,
    });
  }

  const outputCostBilled = (cost?.outputCostUsd ?? 0) * mult;
  const inputCostBilled = (cost?.inputCostUsd ?? 0) * mult;
  const totalBilled = inputCostBilled + outputCostBilled;

  return (
    <div className="mt-3 rounded-md border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-dropdown-hover transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="font-medium text-foreground text-sm">Developer breakdown</span>
          {cost && (
            <span className="tabular-nums text-sm">
              · {fmtTok(cost.inputTokens + cost.outputTokens)} tokens · {fmtEur(totalBilled)}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3 space-y-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              Model: <span className="font-medium text-foreground text-sm">{meta.model}</span>
            </span>
            <span>
              Provider: <span className="font-medium text-foreground text-sm">{meta.provider}</span>
            </span>
            {cost && (
              <span>
                Markup: <span className="font-medium text-foreground text-sm">×{mult}</span>
              </span>
            )}
          </div>

          {/* Input segments */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Input
            </div>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full">
                <tbody>
                  {segments.map((s, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-2.5 py-1.5 text-foreground">{s.label}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm text-muted-foreground">
                        {fmtTok(s.tokens)} tok
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm font-medium">
                        {fmtEur(s.costUsd)}
                      </td>
                    </tr>
                  ))}
                  {cost && (
                    <tr className="bg-muted/40">
                      <td className="px-2.5 py-1.5 font-medium">Input total</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm">
                        {fmtTok(cost.inputTokens)} tok
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm font-semibold">
                        {fmtEur(inputCostBilled)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Output */}
          {cost && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Output
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full">
                  <tbody>
                    <tr>
                      <td className="px-2.5 py-1.5 text-foreground">Generated tokens</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm text-muted-foreground">
                        {fmtTok(cost.outputTokens)} tok
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-sm font-medium">
                        {fmtEur(outputCostBilled)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Total */}
          {cost && (
            <div className="flex items-center justify-between rounded-md bg-foreground text-background px-3 py-2">
              <span className="font-medium">Total billed</span>
              <span className="tabular-nums font-semibold">{fmtEur(totalBilled)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
