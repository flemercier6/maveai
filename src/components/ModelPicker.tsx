import { useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { MODELS, PROVIDERS, type Provider, providerForModel, AUTO_MODEL_ID } from "@/lib/models";
import { isPremiumModel } from "@/hooks/usePlan";
import { ProviderLogo } from "./ProviderLogo";
import { Sparkles, Lock } from "lucide-react";

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
  isFree?: boolean;
  onPremiumLocked?: () => void;
};

export function ModelPicker({ provider, model, onChange, disabled, isFree, onPremiumLocked }: Props) {
  const isAuto = model === AUTO_MODEL_ID;
  const currentModel = MODELS[provider].find((m) => m.id === model);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);

  const showTip = (e: React.SyntheticEvent<HTMLElement>, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.left - 12 });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <Select
        value={model}
        onValueChange={(v) => {
          if (v === AUTO_MODEL_ID) {
            onChange(provider, AUTO_MODEL_ID);
            return;
          }
          if (isFree && isPremiumModel(v)) {
            onPremiumLocked?.();
            return;
          }
          const p = providerForModel(v);
          onChange(p, v);
        }}
        disabled={disabled}
        onOpenChange={(o) => { if (!o) hideTip(); }}
      >
        <SelectTrigger className="w-auto min-w-0 h-9 border-0 bg-transparent gap-2 text-xs rounded-[50px] hover:bg-dropdown-hover focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0">
          <SelectValue>
            <span className="flex items-center gap-1.5 leading-none">
              {!isAuto && (
                <ProviderLogo provider={provider} className="w-4 h-4 shrink-0" />
              )}
              <span className="leading-none">{isAuto ? "Auto" : (currentModel?.label ?? model)}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="w-[260px]">
          <SelectItem
            value={AUTO_MODEL_ID}
            className="py-3.5 bg-[#F8F8F8] data-[state=checked]:bg-[#F8F8F8] focus:bg-[#F8F8F8]"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span className="flex flex-col leading-tight">
                <span className="leading-none">Auto</span>
                <span className="text-[11px] text-muted-foreground font-normal mt-0.5">Pick the best model for your request</span>
              </span>
            </span>
          </SelectItem>
          <SelectSeparator />
          {PROVIDERS.map((p) =>
            MODELS[p.id].map((m) => {
              const locked = isFree && isPremiumModel(m.id);
              return (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  onMouseEnter={(e) => showTip(e, locked ? "Plus only" : m.description)}
                  onMouseLeave={hideTip}
                  onFocus={(e) => showTip(e, locked ? "Plus only" : m.description)}
                  onBlur={hideTip}
                  className={locked ? "opacity-60" : undefined}
                >
                  <span className="flex items-center gap-2 leading-none">
                    <ProviderLogo provider={p.id} className="w-5 h-5 shrink-0" />
                    <span className="leading-none">{m.label}</span>
                    {m.id === "gpt-5.5" && !locked && (
                      <span className="ml-1 rounded-sm bg-blue-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white leading-none">
                        New
                      </span>
                    )}
                    {locked && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/70 leading-none">
                        <Lock className="w-2.5 h-2.5" /> Plus
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            }),
          )}
        </SelectContent>
      </Select>

      {tip &&
        createPortal(
          <div
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translate(-100%, -50%)" }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-[4px] bg-tooltip px-2 py-1 text-xs text-tooltip-foreground shadow-md"
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
