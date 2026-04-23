import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODELS, PROVIDERS, type Provider, providerForModel } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ provider, model, onChange, disabled }: Props) {
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
          const p = providerForModel(v);
          onChange(p, v);
        }}
        disabled={disabled}
        onOpenChange={(o) => { if (!o) hideTip(); }}
      >
        <SelectTrigger className="w-[220px] h-9 bg-card">
          <SelectValue>
            <span className="flex items-center gap-2 leading-none">
              <ProviderLogo provider={provider} className="w-5 h-5 shrink-0" />
              <span className="leading-none">{currentModel?.label ?? model}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-[260px]">
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
            className="pointer-events-none z-[100] whitespace-nowrap rounded-md bg-black px-2 py-1 text-xs text-white shadow-md"
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
