import { useState } from "react";
import { ChevronDown, ChevronRight, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequestMeta } from "@/lib/requestMeta";

type Props = { meta: RequestMeta };

function Section({
  title,
  rightLabel,
  defaultOpen = false,
  children,
}: {
  title: string;
  rightLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-dropdown-hover transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          {title}
        </span>
        {rightLabel && (
          <span className="text-[11px] tabular-nums text-muted-foreground">{rightLabel}</span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1 text-xs text-foreground/85">{children}</div>}
    </div>
  );
}

function CodeBlock({ children, max = 800 }: { children: string; max?: number }) {
  const truncated = children.length > max;
  const shown = truncated ? children.slice(0, max) + "…" : children;
  return (
    <pre className="whitespace-pre-wrap break-words bg-[hsl(var(--dropdown-hover))] rounded-[6px] p-2.5 text-[11px] leading-relaxed font-mono text-foreground/85 max-h-64 overflow-auto">
      {shown}
      {truncated && (
        <span className="block mt-1 text-muted-foreground">
          ({children.length - max} more characters)
        </span>
      )}
    </pre>
  );
}

const fmtTokens = (n: number) => `~${n.toLocaleString("en-US")} tok`;

export function RequestVisualizer({ meta }: Props) {
  const [open, setOpen] = useState(false);

  const systemsTokens = meta.systems.reduce((s, x) => s + x.approxTokens, 0);
  const historyTokens = meta.history.reduce((s, x) => s + x.approxTokens, 0);
  const memoryItem = meta.systems.find((s) => s.label === "User memory (filtered)");

  return (
    <div className="mt-3 rounded-[8px] border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-dropdown-hover transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
          What was sent to the model
          <span className="text-muted-foreground font-normal">
            · {meta.provider}/{meta.model}
          </span>
        </span>
        <span className="flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span>{fmtTokens(meta.approxTotalInputTokens)} in</span>
          {open ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60">
          {/* Summary row */}
          <div className="px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-[hsl(var(--dropdown-hover))]/50">
            <Stat label="System" value={fmtTokens(systemsTokens)} sub={`${meta.systems.length} blocks`} />
            <Stat label="History" value={fmtTokens(historyTokens)} sub={`${meta.history.length} msgs`} />
            <Stat
              label="Memory"
              value={meta.memoryMatches.length ? `${meta.memoryMatches.length} matched` : "none"}
              sub={memoryItem ? fmtTokens(memoryItem.approxTokens) : "0 tok"}
            />
            <Stat
              label="Web"
              value={meta.webContext ? meta.webContext.kind : "none"}
              sub={meta.webContext ? fmtTokens(meta.webContext.approxTokens) : "0 tok"}
            />
          </div>

          {/* Memory keywords */}
          {meta.memoryKeywords.length > 0 && (
            <Section
              title="Query keywords"
              rightLabel={`${meta.memoryKeywords.length} terms`}
              defaultOpen
            >
              <div className="flex flex-wrap gap-1.5">
                {meta.memoryKeywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-[11px] text-foreground/80"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Memory matches */}
          <Section
            title={`Matched memories (${meta.memoryMatches.length})`}
            rightLabel={meta.memoryMatches.length === 0 ? "no relevant memory injected" : undefined}
            defaultOpen={meta.memoryMatches.length > 0}
          >
            {meta.memoryMatches.length === 0 ? (
              <p className="text-muted-foreground">
                No memory matched the current query — none was sent to the model.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {meta.memoryMatches.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-foreground text-background px-1.5 py-0.5 text-[10px] tabular-nums">
                      {m.score.toFixed(2)}
                    </span>
                    <span className="flex-1">
                      <span className="text-muted-foreground mr-1">({m.kind})</span>
                      {m.content}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* System prompts */}
          {meta.systems.map((s, i) => (
            <Section
              key={i}
              title={s.label}
              rightLabel={fmtTokens(s.approxTokens)}
            >
              <CodeBlock>{s.content}</CodeBlock>
            </Section>
          ))}

          {/* History */}
          <Section
            title={`Conversation history (${meta.history.length})`}
            rightLabel={fmtTokens(historyTokens)}
          >
            <div className="space-y-2">
              {meta.history.map((h, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        "uppercase tracking-wide font-semibold",
                        h.role === "user" ? "text-foreground" : "text-foreground/70",
                      )}
                    >
                      {h.role}
                    </span>
                    <span className="tabular-nums">{fmtTokens(h.approxTokens)}</span>
                  </div>
                  <CodeBlock max={500}>{h.content || "(empty)"}</CodeBlock>
                  {h.attachments && h.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {h.attachments.map((a, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center rounded-full bg-[hsl(var(--dropdown-hover))] px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          📎 {a.kind}: {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground tabular-nums">{sub}</span>}
    </div>
  );
}
