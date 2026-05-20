import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { RequestMeta } from "@/lib/requestMeta";
import { USD_TO_EUR, billingMultiplier } from "@/lib/pricing";
import { ProviderLogo } from "@/components/ProviderLogo";
import type { Provider } from "@/lib/models";

const fmtTok = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
};
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
  description?: string;
};

export function RequestBreakdown({ meta }: { meta: RequestMeta }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const cost = meta.cost;
  const inputPricePerTok = cost && cost.inputTokens > 0 ? cost.inputCostUsd / cost.inputTokens : 0;
  const mult = cost?.multiplier ?? 1;

  const segments: Segment[] = [];
  for (const s of meta.systems ?? []) {
    segments.push({
      label: s.label,
      tokens: s.approxTokens,
      costUsd: s.approxTokens * inputPricePerTok * mult,
      description: s.description,
    });
  }
  if (meta.memoryMatches && meta.memoryMatches.length > 0) {
    const memTokens = meta.memoryMatches.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
    segments.push({ label: `Memory matches (${meta.memoryMatches.length})`, tokens: memTokens, costUsd: memTokens * inputPricePerTok * mult });
  }
  if (meta.webContext) {
    segments.push({ label: `Web context · ${meta.webContext.label}`, tokens: meta.webContext.approxTokens, costUsd: meta.webContext.approxTokens * inputPricePerTok * mult });
  }
  const history = meta.history ?? [];
  const histTokens = history.reduce((s, h) => s + h.approxTokens, 0);
  if (histTokens > 0) {
    segments.push({ label: `Conversation history (${history.length} msgs)`, tokens: histTokens, costUsd: histTokens * inputPricePerTok * mult });
  }

  const outputCostBilled = (cost?.outputCostUsd ?? 0) * mult;
  const inputCostBilled = (cost?.inputCostUsd ?? 0) * mult;
  const totalBilled = inputCostBilled + outputCostBilled;
  const totalTokens = (cost?.inputTokens ?? 0) + (cost?.outputTokens ?? 0);

  // Position dropdown below the tag button, right-aligned
  const openDropdown = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.right });
    setOpen(true);
  };

  // Dismiss on click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (!dropRef.current?.contains(target) && !btnRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="ml-auto inline-flex items-center gap-1.5 h-7 pl-1 pr-2.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-80 transition-opacity shrink-0"
      >
        {meta.models && meta.models.length > 1 ? (
          <span className="inline-flex items-center -space-x-1.5 shrink-0">
            {meta.models.map((m, i) => (
              <ProviderLogo
                key={`${m.provider}-${i}`}
                provider={m.provider as Provider}
                className="h-5 w-5 ring-2 ring-foreground bg-foreground"
              />
            ))}
          </span>
        ) : (
          <span className="inline-flex items-center pl-1.5">
            <Sparkles className="w-3 h-3 shrink-0" />
          </span>
        )}
        <span className="tabular-nums">
          {fmtTok(totalTokens)} tok
          {cost ? ` · ${fmtEur(totalBilled)}` : ""}
        </span>
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: "translateX(-100%)",
            zIndex: 9999,
            maxHeight: "70vh",
            overflowY: "auto",
          }}
          className="w-[420px] max-w-[calc(100vw-32px)] rounded-xl bg-foreground text-background shadow-xl text-sm"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
            <span className="font-semibold text-sm">Developer breakdown</span>
            <span className="tabular-nums text-white/60 text-sm">
              {meta.models && meta.models.length > 1
                ? `${meta.models.length} models`
                : `${meta.model} · ${meta.provider}`}
            </span>
          </div>

          <div className="px-4 py-3 space-y-4">
            {/* Pipeline (multi-model) */}
            {meta.models && meta.models.length > 1 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Pipeline</div>
                <div className="space-y-1.5">
                  {meta.models.map((m, i) => {
                    const modelMult = billingMultiplier(m.model);
                    const billed = (m.inputCostUsd + m.outputCostUsd) * modelMult;
                    return (
                      <div key={i} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 min-w-0">
                          <ProviderLogo provider={m.provider as Provider} className="h-4 w-4 shrink-0 bg-white" />
                          <span className="text-white/70 truncate">{m.model}</span>
                          <span className="text-white/40 text-xs shrink-0">· {m.role}</span>
                        </span>
                        <div className="flex items-center gap-3 tabular-nums shrink-0">
                          <span className="text-white/50">{fmtTok(m.inputTokens + m.outputTokens)} tok</span>
                          <span className="font-medium">{fmtEur(billed)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Input segments */}
            {segments.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Input</div>
                <div className="space-y-1">
                  {segments.map((s, i) => (
                    <div key={i} className="flex items-start justify-between gap-3">
                      <span className="text-white/70 leading-snug">{s.label}</span>
                      <span className="tabular-nums text-white/50 whitespace-nowrap">{fmtTok(s.tokens)} tok</span>
                    </div>
                  ))}
                  {cost && (
                    <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-white/10">
                      <span className="font-medium">Input total</span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-white/50">{fmtTok(cost.inputTokens)} tok</span>
                        <span className="font-medium">{fmtEur(inputCostBilled)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Output */}
            {cost && (
              <div>
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Output</div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white/70">Generated tokens</span>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-white/50">{fmtTok(cost.outputTokens)} tok</span>
                    <span className="font-medium">{fmtEur(outputCostBilled)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Total */}
            {cost && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2">
                <span className="font-semibold">Total billed</span>
                <span className="tabular-nums font-semibold">{fmtEur(totalBilled)}</span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
