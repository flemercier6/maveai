import { useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { MODELS, PROVIDERS, type Provider, providerForModel, AUTO_MODEL_ID } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";
import { Sparkles } from "lucide-react";

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ provider, model, onChange, disabled }: Props) {
  const isAuto = model === AUTO_MODEL_ID;
  const currentModel = MODELS[provider].find((m) => m.id === model);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);

  const showTip = (e: React.SyntheticEvent<HTMLElement>, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 12 });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <Select
        value={model}
        onValueChange={(v) => {
          if (v === AUTO_MODEL_ID) {
            // Keep provider as-is; routing happens at send time
            onChange(provider, AUTO_MODEL_ID);
            return;
          }
          const p = providerForModel(v);
          onChange(p, v);
        }}
        disabled={disabled}
        onOpenChange={(o) => { if (!o) hideTip(); }}
      >
        <SelectTrigger className="w-auto min-w-0 h-9 bg-card gap-2">
          <SelectValue>
            <span className="flex items-center gap-2 leading-none">
              {isAuto ? (
                <Sparkles className="w-4 h-4 shrink-0" />
              ) : (
                <ProviderLogo provider={provider} className="w-5 h-5 shrink-0" />
              )}
              <span className="leading-none">{isAuto ? "Auto" : (currentModel?.label ?? model)}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[260px]">
          <SelectItem
            value={AUTO_MODEL_ID}
            className="py-2.5 bg-[#F8F8F8] data-[state=checked]:bg-[#F8F8F8] focus:bg-[#F8F8F8]"
            onMouseEnter={(e) => showTip(e, "Picks the best model for your message")}
            onMouseLeave={hideTip}
            onFocus={(e) => showTip(e, "Picks the best model for your message")}
            onBlur={hideTip}
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
            MODELS[p.id].map((m) => (
              <SelectItem
                key={m.id}
                value={m.id}
                onMouseEnter={(e) => showTip(e, m.description)}
                onMouseLeave={hideTip}
                onFocus={(e) => showTip(e, m.description)}
                onBlur={hideTip}
              >
                <span className="flex items-center gap-2 leading-none">
                  <ProviderLogo provider={p.id} className="w-5 h-5 shrink-0" />
                  <span className="leading-none">{m.label}</span>
                </span>
              </SelectItem>
            )),
          )}
        </SelectContent>
      </Select>

      {tip &&
        createPortal(
          <div
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translateY(-50%)" }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-[4px] bg-black px-2 py-1 text-xs text-white shadow-md"
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
