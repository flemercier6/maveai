import { memo, useMemo, useState } from "react";
import { Sparkles, Check, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ClarifyOption = { label: string };
export type ClarifyQuestion = {
  question: string;
  header?: string;
  multi?: boolean;
  options: ClarifyOption[];
};

type Answer = {
  selected: number[]; // indices into options
  other?: string;
};

type Props = {
  questions: ClarifyQuestion[];
  onSubmit: (combined: string) => void;
  onSkip: () => void;
};

function ClarifyCardImpl({ questions, onSubmit, onSkip }: Props) {
  const [answers, setAnswers] = useState<Answer[]>(() =>
    questions.map(() => ({ selected: [], other: "" })),
  );

  const toggle = (qIdx: number, optIdx: number) => {
    setAnswers((prev) => {
      const next = prev.slice();
      const cur = { ...next[qIdx] };
      const q = questions[qIdx];
      if (q.multi) {
        cur.selected = cur.selected.includes(optIdx)
          ? cur.selected.filter((i) => i !== optIdx)
          : [...cur.selected, optIdx];
      } else {
        cur.selected = cur.selected[0] === optIdx ? [] : [optIdx];
      }
      next[qIdx] = cur;
      return next;
    });
  };

  const setOther = (qIdx: number, value: string) => {
    setAnswers((prev) => {
      const next = prev.slice();
      next[qIdx] = { ...next[qIdx], other: value };
      return next;
    });
  };

  const canSubmit = useMemo(
    () => answers.some((a, i) => a.selected.length > 0 || (a.other ?? "").trim().length > 0),
    [answers],
  );

  const handleSubmit = () => {
    const lines: string[] = [];
    questions.forEach((q, i) => {
      const a = answers[i];
      const picks = a.selected.map((idx) => q.options[idx]?.label).filter(Boolean);
      const other = (a.other ?? "").trim();
      if (!picks.length && !other) return;
      const parts: string[] = [];
      if (picks.length) parts.push(picks.join(", "));
      if (other) parts.push(other);
      lines.push(`**${q.question}** ${parts.join(" — ")}`);
    });
    if (!lines.length) return;
    const combined = lines.join("\n");
    onSubmit(combined);
  };

  return (
    <div className="max-w-2xl mx-auto mb-3">
      <div className="rounded-2xl border border-border bg-card shadow-[0_4px_16px_-6px_hsl(0_0%_0%/0.08)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Sparkles className="w-3.5 h-3.5" />
            <span>A few quick questions to get this right</span>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Dismiss"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-5 max-h-[55vh] overflow-y-auto">
          {questions.map((q, qIdx) => {
            const a = answers[qIdx];
            return (
              <div key={qIdx} className="space-y-2">
                <div className="flex items-baseline gap-2">
                  {q.header && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {q.header}
                    </span>
                  )}
                  <h4 className="text-sm font-medium text-foreground">{q.question}</h4>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((opt, optIdx) => {
                    const active = a.selected.includes(optIdx);
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => toggle(qIdx, optIdx)}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-background text-foreground hover:bg-dropdown-hover",
                        ].join(" ")}
                      >
                        {active && <Check className="w-3 h-3" />}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <Input
                  value={a.other ?? ""}
                  onChange={(e) => setOther(qIdx, e.target.value)}
                  placeholder="Other (optional)…"
                  className="h-8 text-xs"
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-8 rounded-full"
          >
            Send answers
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export const ClarifyCard = memo(ClarifyCardImpl);
