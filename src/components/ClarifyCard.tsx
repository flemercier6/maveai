import { memo, useMemo, useState } from "react";
import { Check, X, ArrowRight } from "lucide-react";

export type ClarifyOption = { label: string };
export type ClarifyQuestion = {
  question: string;
  header?: string;
  multi?: boolean;
  options: ClarifyOption[];
};

type Answer = {
  selected: number[];
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
      <div
        className="bg-white dark:bg-[#181818] rounded-[20px] overflow-hidden flex flex-col"
        style={{ boxShadow: "0px 4px 5px rgba(0,0,0,0.1)" }}
      >
        {/* Header */}
        <div className="bg-[#f8f7f5] dark:bg-[#242424] px-[15px] py-[18px] flex items-center gap-[11px]">
          {q.header && (
            <span
              className="bg-[#e0e0e0] dark:bg-[#444444] rounded-[50px] text-[10px] text-[#888888] font-normal whitespace-nowrap"
              style={{ padding: "5px 7px" }}
            >
              {q.header}
            </span>
          )}
          <h4 className="flex-1 text-[14px] font-semibold text-black dark:text-white leading-normal">
            {q.question}
          </h4>
          <span className="text-[14px] text-[#888888] font-normal whitespace-nowrap">
            {step + 1}/{total}
          </span>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close"
            className="inline-flex items-center justify-center w-[17px] h-[17px] text-[#888888] hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-[17px] h-[17px]" strokeWidth={1.5} />
          </button>
        </div>

        {/* Options */}
        <div className="px-[20px] py-[11px] flex flex-col gap-[8px]">
          {q.options.map((opt, optIdx) => {
            const active = a.selected.includes(optIdx);
            return (
              <button
                key={optIdx}
                type="button"
                onClick={() => toggle(optIdx)}
                className={[
                  "flex items-center gap-[10px] rounded-[12px] p-[10px] text-[12px] text-black dark:text-white text-left transition-colors",
                  active
                    ? "bg-[#e0e0e0] dark:bg-[#444444]"
                    : "bg-[#f8f7f5] dark:bg-[#242424] hover:bg-[#e0e0e0] dark:hover:bg-[#444444]",
                ].join(" ")}
              >
                {active && <Check className="w-[9px] h-[9px] shrink-0" strokeWidth={3} />}
                <span>{opt.label}</span>
              </button>
            );
          })}
          <input
            type="text"
            value={a.other ?? ""}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Autre (optionel)"
            className="border border-[#e0e0e0] dark:border-[#444444] rounded-[12px] p-[10px] text-[12px] text-black dark:text-white placeholder:text-[#888888] bg-white dark:bg-[#242424] outline-none focus:border-[#888888] dark:focus:border-[#888888]"
          />
        </div>

        {/* Actions */}
        <div className="px-[20px] pb-[8px] flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="text-[14px] text-[#888888] font-normal hover:text-foreground transition-colors p-[10px]"
          >
            Cancel
          </button>
          <div className="flex items-center gap-[10px]">
            <button
              type="button"
              onClick={onSkip}
              className="text-[14px] text-[#888888] font-normal hover:text-foreground transition-colors p-[10px]"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!canAdvance}
              className="bg-black dark:bg-white text-white dark:text-black text-[14px] font-normal rounded-[50px] flex items-center justify-center gap-[10px] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              style={{ padding: "10px" }}
            >
              <span>{isLast ? "Send" : "Next"}</span>
              <span className="inline-flex items-center justify-center rounded-full" style={{ width: "16.971px", height: "16.971px" }}>
                <ArrowRight className="w-[12px] h-[12px]" strokeWidth={2} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ClarifyCard = memo(ClarifyCardImpl);
