import { memo, useMemo, useState } from "react";
import { Sparkles, Check, X, ArrowRight, ArrowLeft } from "lucide-react";
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
  const [step, setStep] = useState(0);
  const total = questions.length;
  const isLast = step === total - 1;
  const q = questions[step];
  const a = answers[step];

  const toggle = (optIdx: number) => {
    setAnswers((prev) => {
      const next = prev.slice();
      const cur = { ...next[step] };
      // Always allow multi-select: clicking toggles the option in/out.
      cur.selected = cur.selected.includes(optIdx)
        ? cur.selected.filter((i) => i !== optIdx)
        : [...cur.selected, optIdx];
      next[step] = cur;
      return next;
    });
  };

  const setOther = (value: string) => {
    setAnswers((prev) => {
      const next = prev.slice();
      next[step] = { ...next[step], other: value };
      return next;
    });
  };

  const canAdvance = useMemo(
    () => a.selected.length > 0 || (a.other ?? "").trim().length > 0,
    [a],
  );

  const handleNext = () => {
    if (!isLast) {
      setStep((s) => Math.min(s + 1, total - 1));
      return;
    }
    // Last step → build combined answer
    const lines: string[] = [];
    questions.forEach((qq, i) => {
      const aa = answers[i];
      const picks = aa.selected.map((idx) => qq.options[idx]?.label).filter(Boolean);
      const other = (aa.other ?? "").trim();
      if (!picks.length && !other) return;
      const parts: string[] = [];
      if (picks.length) parts.push(picks.join(", "));
      if (other) parts.push(other);
      lines.push(`**${qq.question}** ${parts.join(" — ")}`);
    });
    if (!lines.length) return;
    onSubmit(lines.join("\n"));
  };

  return (
    <div className="max-w-2xl mx-auto mb-3">
      <div className="rounded-2xl border border-border bg-card shadow-[0_4px_16px_-6px_hsl(0_0%_0%/0.08)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Sparkles className="w-3.5 h-3.5" />
            <span>A few quick questions to get this right</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {step + 1} / {total}
            </span>
            <button
              type="button"
              onClick={onSkip}
              aria-label="Dismiss"
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-dropdown-hover transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-muted">
          <div
            className="h-full bg-foreground transition-all duration-300"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>

        <div className="px-4 py-4 space-y-3">
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
                  onClick={() => toggle(optIdx)}
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
            onChange={(e) => setOther(e.target.value)}
            placeholder="Other (optional)…"
            className="h-8 text-xs"
          />
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border bg-muted/30">
          {step > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="h-8 rounded-full text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Button>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-muted-foreground hover:text-foreground px-2"
            >
              Skip
            </button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleNext}
            disabled={!canAdvance}
            className="h-8 rounded-full"
          >
            {isLast ? "Send answers" : "Next"}
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export const ClarifyCard = memo(ClarifyCardImpl);
